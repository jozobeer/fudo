import type { ContentBlock } from '@fudo/llm'
import type { ApprovalRequested, AskRequested } from '@fudo/safety'
import type { SessionEvent } from '@fudo/session'
import {
  sessionEventOf,
  type UiEvent,
  type UiSessionEvent,
  type UiStreamChunk,
} from '@fudo/ui-protocol'
import { firstLine, oneLine, truncate } from './text.ts'

export type NoticeLevel = 'info' | 'warn' | 'error'
export type ToolStatus = 'running' | 'done' | 'error'

/** One rendered piece of the conversation. Views choose how to draw them. */
export type ConversationBlock =
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'assistant'; readonly text: string }
  | {
      readonly kind: 'tool'
      readonly callId: string
      readonly name: string
      readonly summary: string
      readonly status: ToolStatus
      readonly result: string
    }
  | { readonly kind: 'notice'; readonly level: NoticeLevel; readonly text: string }

/** Everything a UI derives from the event stream. No I/O, no timers. */
export interface Conversation {
  readonly blocks: ReadonlyArray<ConversationBlock>
  /** Text streamed for the step that has not settled yet. */
  readonly live: string
  /** Newest applied `seq`; the transport may replay a boundary event twice. */
  readonly lastSeq: number
  readonly running: boolean
  readonly approval: ApprovalRequested | undefined
  readonly ask: AskRequested | undefined
}

export const emptyConversation: Conversation = {
  blocks: [],
  live: '',
  lastSeq: 0,
  running: false,
  approval: undefined,
  ask: undefined,
}

const notice = (state: Conversation, level: NoticeLevel, text: string): Conversation => ({
  ...state,
  blocks: [...state.blocks, { kind: 'notice', level, text }],
})

const textOf = (content: ReadonlyArray<ContentBlock>): string =>
  content
    .flatMap((block) => (block.type === 'text' ? [block.text.trim()] : []))
    .filter((text) => text !== '')
    .join('\n\n')

const resultOf = (content: ReadonlyArray<ContentBlock>): string =>
  truncate(firstLine(textOf(content)), 200)

/** The event types each handler owns; a type the tables do not name goes to the generic view. */
const STEP_TYPES: ReadonlySet<string> = new Set([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
])
const MESSAGE_TYPES: ReadonlySet<string> = new Set(['user/message', 'assistant/message'])
const TOOL_TYPES: ReadonlySet<string> = new Set(['tool/call', 'tool/result'])
const COMMAND_TYPES: ReadonlySet<string> = new Set(['command/run', 'command/done'])

type StepEvent = Extract<
  SessionEvent,
  { type: 'turn/start' | 'turn/end' | 'step/start' | 'step/end' }
>

const applyTurn = (state: Conversation, event: StepEvent): Conversation => {
  switch (event.type) {
    case 'turn/start':
      return { ...state, running: true, live: '' }
    case 'turn/end': {
      const ended = { ...state, running: false, live: '', approval: undefined, ask: undefined }
      const reason = event.data.reason
      if (reason.kind === 'error') {
        return notice(ended, 'error', reason.failure.code + ': ' + reason.failure.message)
      }
      return reason.kind === 'cancelled' ? notice(ended, 'info', 'cancelled') : ended
    }
    case 'step/start':
      return { ...state, live: '' }
    case 'step/end':
      return state
  }
}

type MessageEvent = Extract<SessionEvent, { type: 'user/message' | 'assistant/message' }>

const applyMessage = (state: Conversation, event: MessageEvent): Conversation => {
  switch (event.type) {
    case 'user/message':
      return event.data.source === 'user'
        ? { ...state, blocks: [...state.blocks, { kind: 'user', text: event.data.text }] }
        : state
    case 'assistant/message': {
      const text = textOf(event.data.content)
      return text === ''
        ? { ...state, live: '' }
        : {
            ...state,
            live: '',
            blocks: [...state.blocks, { kind: 'assistant', text }],
          }
    }
  }
}

type ToolEvent = Extract<SessionEvent, { type: 'tool/call' | 'tool/result' }>

const applyTool = (state: Conversation, event: ToolEvent): Conversation => {
  switch (event.type) {
    case 'tool/call':
      return {
        ...state,
        blocks: [
          ...state.blocks,
          {
            kind: 'tool',
            callId: event.data.callId,
            name: event.data.name,
            summary: truncate(oneLine(event.data.arguments), 80),
            status: 'running',
            result: '',
          },
        ],
      }
    case 'tool/result': {
      const status: ToolStatus = event.data.isError ? 'error' : 'done'
      const result = resultOf(event.data.content)
      return {
        ...state,
        blocks: state.blocks.map((block) =>
          block.kind === 'tool' && block.callId === event.data.callId
            ? { ...block, status, result }
            : block,
        ),
      }
    }
  }
}

/** Events a UI shows without a model turn: approvals, questions, cwd moves. */
const applyInteraction = (state: Conversation, event: SessionEvent): Conversation => {
  switch (event.type) {
    case 'safety/approval/requested':
      return notice(
        { ...state, approval: event.data },
        'warn',
        'approval required: ' + event.data.tool + ' (' + event.data.reason + ')',
      )
    case 'safety/approval/answered':
      return state.approval?.callId === event.data.callId
        ? { ...state, approval: undefined }
        : state
    case 'interaction/ask/requested':
      return notice({ ...state, ask: event.data }, 'info', '? ' + event.data.question)
    case 'interaction/ask/answered':
      return state.ask?.id === event.data.id ? { ...state, ask: undefined } : state
    case 'session/cwd/changed':
      return notice(state, 'info', 'cwd: ' + event.data.cwd)
    default:
      return state
  }
}

type CommandEvent = Extract<SessionEvent, { type: 'command/run' | 'command/done' }>

/** A command is the human talking to the session: what was typed, then what came back. */
const applyCommand = (state: Conversation, event: CommandEvent): Conversation =>
  event.type === 'command/run'
    ? notice(
        state,
        'info',
        '/' + event.data.name + (event.data.input === '' ? '' : ' ' + event.data.input),
      )
    : notice(state, event.data.ok ? 'info' : 'error', event.data.text)

const applySession = (state: Conversation, raw: UiSessionEvent): Conversation => {
  if (raw.seq <= state.lastSeq) return state
  const event = sessionEventOf(raw)
  const opened = { ...state, lastSeq: raw.seq }
  // One family per handler; an event no family claims goes to the generic view.
  if (STEP_TYPES.has(event.type)) return applyTurn(opened, event as StepEvent)
  if (MESSAGE_TYPES.has(event.type)) return applyMessage(opened, event as MessageEvent)
  if (TOOL_TYPES.has(event.type)) return applyTool(opened, event as ToolEvent)
  if (COMMAND_TYPES.has(event.type)) return applyCommand(opened, event as CommandEvent)
  return applyInteraction(opened, event)
}

const applyStream = (state: Conversation, chunk: UiStreamChunk): Conversation =>
  chunk.chunk.type === 'text-delta' && chunk.chunk.text !== ''
    ? { ...state, live: state.live + chunk.chunk.text }
    : state

/** Folds one UI event into the conversation. Pure: the same input gives the same state. */
export const applyEvent = (state: Conversation, event: UiEvent): Conversation =>
  event.kind === 'stream' ? applyStream(state, event.chunk) : applySession(state, event.event)
