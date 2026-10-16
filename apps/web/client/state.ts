import type { UiEvent, UiSessionEvent } from '@jozo-harness/ui-protocol'
import { applyEvent, emptyConversation, type Conversation } from '@jozo-harness/ui-view'

/** What the header says about the session behind the page. */
export interface SessionInfo {
  readonly cwd: string
  readonly model: string
  readonly turns: number
}

const emptyInfo: SessionInfo = { cwd: '', model: '', turns: 0 }

/** What the browser shows: the conversation, the socket state, the draft, and the session. */
export interface WebState {
  readonly conversation: Conversation
  readonly connected: boolean
  readonly draft: string
  readonly info: SessionInfo
}

export const initialState: WebState = {
  conversation: emptyConversation,
  connected: false,
  draft: '',
  info: emptyInfo,
}

export const withConnection = (state: WebState, connected: boolean): WebState => ({
  ...state,
  connected,
})

export const withDraft = (state: WebState, draft: string): WebState => ({ ...state, draft })

/** The event bodies arrive as unknown; a header shows nothing it could not read. */
const fieldOf = (data: unknown, key: string): unknown =>
  typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined

const withCwd = (info: SessionInfo, data: unknown): SessionInfo => {
  const cwd = fieldOf(data, 'cwd')
  return typeof cwd === 'string' ? { ...info, cwd } : info
}

const withModel = (info: SessionInfo, data: unknown): SessionInfo => {
  const provider = fieldOf(data, 'provider')
  const model = fieldOf(data, 'model')
  return typeof provider === 'string' && typeof model === 'string'
    ? { ...info, model: provider + '/' + model }
    : info
}

const withTurn = (info: SessionInfo, data: unknown): SessionInfo => {
  const turn = fieldOf(data, 'turn')
  return typeof turn === 'number' ? { ...info, turns: Math.max(info.turns, turn) } : info
}

/** The events the header reads, by name: one lookup instead of a chain of tests. */
const INFO_READERS: Readonly<Record<string, (info: SessionInfo, data: unknown) => SessionInfo>> = {
  'session/header': withCwd,
  'session/cwd/changed': withCwd,
  'request/header': withModel,
  'turn/start': withTurn,
}

const infoAfter = (info: SessionInfo, event: UiSessionEvent): SessionInfo => {
  const read = INFO_READERS[event.type]
  return read === undefined ? info : read(info, event.data)
}

export const applyUiEvent = (state: WebState, event: UiEvent): WebState => ({
  ...state,
  info: event.kind === 'session' ? infoAfter(state.info, event.event) : state.info,
  conversation: applyEvent(state.conversation, event),
})
