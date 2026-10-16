import type { Conversation, ConversationBlock } from '@jozo-harness/ui-view'
import { plainText } from '@jozo-harness/ui-view'
import type { SessionSummary } from '../src/shared/rpc.ts'
import { escapeHtml } from './html.ts'
import { renderMarkdown } from './markdown.ts'
import type { WebState } from './state.ts'

const text = (value: string): string => escapeHtml(plainText(value))

const markdown = (value: string): string => renderMarkdown(plainText(value))

type ToolBlock = Extract<ConversationBlock, { kind: 'tool' }>

const stateName = (status: ToolBlock['status']): string =>
  status === 'error' ? 'failed' : status === 'running' ? 'running' : 'done'

/** The line every tool card carries, whether or not its body is there to expand. */
const toolHead = (block: ToolBlock): string =>
  '<span class="tool-name">' +
  text(block.name) +
  '</span>' +
  '<span class="tool-summary">' +
  text(block.summary) +
  '</span>' +
  '<span class="tool-state">' +
  stateName(block.status) +
  '</span>'

const toolHtml = (block: ToolBlock): string => {
  if (block.output === '') {
    return (
      '<article class="block tool ' +
      block.status +
      '"><div class="tool-head">' +
      toolHead(block) +
      '</div></article>'
    )
  }
  const open = block.status === 'error' ? ' open' : ''
  return (
    '<article class="block tool ' +
    block.status +
    '">' +
    '<details class="tool-card"' +
    open +
    '>' +
    '<summary class="tool-head">' +
    toolHead(block) +
    '</summary>' +
    '<pre class="tool-output">' +
    text(block.output) +
    '</pre>' +
    '</details></article>'
  )
}

const renderBlock = (block: ConversationBlock): string => {
  switch (block.kind) {
    case 'user':
      return (
        '<article class="block user"><div class="role">you</div>' +
        '<div class="body">' +
        text(block.text) +
        '</div></article>'
      )
    case 'assistant':
      return (
        '<article class="block assistant"><div class="role">agent</div>' +
        '<div class="body markdown">' +
        markdown(block.text) +
        '</div></article>'
      )
    case 'tool':
      return toolHtml(block)
    case 'notice':
      return '<article class="block notice ' + block.level + '">' + text(block.text) + '</article>'
  }
}

/** Rendered blocks of the conversation last painted; the array changes only when blocks do. */
let paintedBlocks: ReadonlyArray<ConversationBlock> | undefined
let paintedHtml = ''

const blocksHtml = (blocks: ReadonlyArray<ConversationBlock>): string => {
  if (blocks !== paintedBlocks) {
    paintedBlocks = blocks
    paintedHtml = blocks.map(renderBlock).join('')
  }
  return paintedHtml
}

const approvalHtml = (conversation: Conversation): string => {
  const approval = conversation.approval
  if (approval === undefined) return ''
  const callId = escapeHtml(approval.callId)
  return (
    '<section class="block approval">' +
    '<div class="approval-text"><strong>Approve ' +
    text(approval.tool) +
    '?</strong> ' +
    text(approval.reason) +
    '</div>' +
    '<div class="approval-actions">' +
    '<button class="primary" data-approve="true" data-call-id="' +
    callId +
    '">Allow</button>' +
    '<button data-approve="false" data-call-id="' +
    callId +
    '">Deny</button>' +
    '</div><div class="card-hint">or press y / n</div></section>'
  )
}

const askHtml = (conversation: Conversation): string => {
  const ask = conversation.ask
  if (ask === undefined) return ''
  const id = escapeHtml(ask.id)
  const options = ask.options
    .map(
      (option) =>
        '<button data-answer="' +
        escapeHtml(option) +
        '" data-ask-id="' +
        id +
        '">' +
        text(option) +
        '</button>',
    )
    .join('')
  return (
    '<section class="block ask"><div class="ask-question">' +
    text(ask.question) +
    '</div>' +
    (options === '' ? '' : '<div class="ask-options">' + options + '</div>') +
    '<div class="card-hint">Enter sends your answer</div></section>'
  )
}

/** One HTML string for the whole conversation; the DOM layer replaces it. */
export const renderConversation = (conversation: Conversation): string => {
  const live =
    conversation.live === ''
      ? ''
      : '<article class="block assistant live"><div class="body markdown">' +
        markdown(conversation.live) +
        '</div></article>'
  return blocksHtml(conversation.blocks) + live + approvalHtml(conversation) + askHtml(conversation)
}

const basenameOf = (path: string): string => {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

const clockOf = (time: number): string => {
  const at = new Date(time)
  const hours = String(at.getHours()).padStart(2, '0')
  const minutes = String(at.getMinutes()).padStart(2, '0')
  return hours + ':' + minutes
}

const sessionRow = (state: WebState, summary: SessionSummary): string => {
  const active = summary.id === state.sessionId ? ' active' : ''
  return (
    '<button class="session' +
    active +
    '" data-session-id="' +
    escapeHtml(summary.id) +
    '" type="button"><span class="session-id">' +
    text(summary.id.slice(0, 8)) +
    '</span><span class="session-where">' +
    text(basenameOf(summary.cwd)) +
    '</span><span class="session-when">' +
    clockOf(summary.createdAt) +
    '</span></button>'
  )
}

/** The left rail: every session the store holds, the one on screen marked. */
export const renderSessions = (state: WebState): string =>
  state.sessions.map((summary) => sessionRow(state, summary)).join('')

const hintOf = (state: WebState): string => {
  if (state.problem !== '') return state.problem
  if (!state.connected) return 'reconnecting…'
  const conversation = state.conversation
  if (conversation.approval !== undefined) return 'waiting for your approval'
  if (conversation.ask !== undefined) return 'answer the question and press Enter'
  return conversation.running ? 'working…' : 'ready'
}

/** The status strip: the connection, where the session runs, and what the app expects next. */
export const renderStatus = (state: WebState): string => {
  const info = state.info
  return (
    '<span class="dot ' +
    (state.connected ? 'on' : 'off') +
    '"></span>' +
    '<span class="title">jozo-harness</span>' +
    (info.cwd === '' ? '' : '<span class="where">' + text(info.cwd) + '</span>') +
    (info.model === '' ? '' : '<span class="model">' + text(info.model) + '</span>') +
    '<span class="hint' +
    (state.problem === '' ? '' : ' error') +
    '">' +
    text(hintOf(state)) +
    '</span>'
  )
}
