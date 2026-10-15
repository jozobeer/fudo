import { plainText } from '@jozo-harness/ui-view'
/** Everything a page puts into HTML goes through here. */
export const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const text = (value) => escapeHtml(plainText(value))
const toolBlock = (block) => {
  const result =
    block.result === '' ? '' : '<div class="tool-result">' + text(block.result) + '</div>'
  return (
    '<div class="block tool ' +
    block.status +
    '"><div class="tool-head">' +
    text(block.name) +
    ' <span class="summary">' +
    text(block.summary) +
    '</span></div>' +
    result +
    '</div>'
  )
}
const renderBlock = (block) => {
  switch (block.kind) {
    case 'user':
      return '<div class="block user">' + text(block.text) + '</div>'
    case 'assistant':
      return '<div class="block assistant">' + text(block.text) + '</div>'
    case 'tool':
      return toolBlock(block)
    case 'notice':
      return '<div class="block notice ' + block.level + '">' + text(block.text) + '</div>'
  }
}
const approvalHtml = (conversation) => {
  const approval = conversation.approval
  if (approval === undefined) return ''
  const callId = escapeHtml(approval.callId)
  return (
    '<div class="approval"><div class="approval-text">approve ' +
    text(approval.tool) +
    '? ' +
    text(approval.reason) +
    '</div><div class="approval-actions">' +
    '<button data-approve="true" data-call-id="' +
    callId +
    '">Allow</button>' +
    '<button data-approve="false" data-call-id="' +
    callId +
    '">Deny</button></div></div>'
  )
}
/** One HTML string for the whole conversation; the DOM layer replaces it. */
export const renderConversation = (conversation) => {
  const live =
    conversation.live === ''
      ? ''
      : '<div class="block assistant live">' + text(conversation.live) + '</div>'
  return conversation.blocks.map(renderBlock).join('') + live + approvalHtml(conversation)
}
const hintOf = (state) => {
  if (!state.connected) return 'reconnecting…'
  const conversation = state.conversation
  if (conversation.approval !== undefined) return 'waiting for your approval'
  if (conversation.ask !== undefined) return 'answer the question and press Enter'
  return conversation.running ? 'working…' : 'ready'
}
/** The status strip: connection and what the app expects next. */
export const renderStatus = (state) =>
  '<span class="dot ' +
  (state.connected ? 'on' : 'off') +
  '"></span><span class="title">jozo-harness</span><span class="hint">' +
  hintOf(state) +
  '</span>'
