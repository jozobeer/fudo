import type { Conversation, ConversationBlock } from '@jozo-harness/ui-view'
import { plainText } from '@jozo-harness/ui-view'
import type { RunStateView, SessionSummary, SettingsView } from '../src/shared/rpc.ts'
import { escapeHtml } from './html.ts'
import { THEMES } from './theme.ts'
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
  const short = summary.id.slice(0, 8)
  return (
    '<button class="session' +
    active +
    '" data-session-id="' +
    escapeHtml(summary.id) +
    '" type="button"><span class="session-name">' +
    text(summary.title === '' ? short : summary.title) +
    '</span><span class="session-when">' +
    clockOf(summary.createdAt) +
    '</span><span class="session-where">' +
    text(short + ' · ' + basenameOf(summary.cwd)) +
    '</span></button>'
  )
}

const themesHtml = (state: WebState): string =>
  '<div class="theme-choice">' +
  THEMES.map(
    (theme) =>
      '<button class="theme' +
      (theme === state.theme ? ' active' : '') +
      '" data-theme="' +
      theme +
      '" type="button">' +
      theme +
      '</button>',
  ).join('') +
  '</div>'

const goalHtml = (goal: RunStateView['goal']): string =>
  goal === null
    ? '<div class="run-empty">no goal</div>'
    : '<div class="run-goal"><span class="run-objective">' +
      text(goal.objective) +
      '</span><span class="run-phase ' +
      escapeHtml(goal.phase) +
      '">' +
      text(goal.phase) +
      '</span><span class="run-rounds">' +
      String(goal.rounds) +
      '/' +
      String(goal.maxRounds) +
      '</span></div>'

const schedulesHtml = (schedules: RunStateView['schedules']): string =>
  schedules.length === 0
    ? ''
    : '<ul class="run-schedules">' +
      schedules
        .map(
          (schedule) =>
            '<li><span class="run-when">' +
            text(schedule.when) +
            '</span><span class="run-prompt">' +
            text(schedule.prompt) +
            '</span></li>',
        )
        .join('') +
      '</ul>'

const jobsHtml = (jobs: RunStateView['jobs']): string =>
  jobs.length === 0
    ? ''
    : '<ul class="run-jobs">' +
      jobs
        .map(
          (job) =>
            '<li class="run-job ' +
            (job.running ? 'running' : 'done') +
            '"><span class="run-job-state">' +
            (job.running ? 'running' : 'done') +
            '</span><span class="run-job-command">' +
            text(job.command) +
            '</span></li>',
        )
        .join('') +
      '</ul>'

/** What the session works toward: its goal, its standing schedules, and its background work. */
export const renderRun = (state: WebState): string => {
  const run = state.run
  return (
    '<span class="rail-label">run</span>' +
    (run === undefined
      ? '<div class="run-empty">reading…</div>'
      : goalHtml(run.goal) + schedulesHtml(run.schedules) + jobsHtml(run.jobs))
  )
}

/** The rail's foot: what the session works toward, how the page is lit, and the settings. */
export const renderRail = (state: WebState): string =>
  renderRun(state) +
  '<span class="rail-label">theme</span>' +
  themesHtml(state) +
  '<button id="settings" class="rail-button' +
  (state.panelOpen ? ' active' : '') +
  '" type="button">settings</button>'

const panelRow = (name: string, value: string): string =>
  '<div class="panel-row"><span class="panel-name">' +
  name +
  '</span><span class="panel-value">' +
  text(value) +
  '</span></div>'

const modelsHtml = (state: WebState): string => {
  if (state.models.length === 0) {
    return '<div class="panel-actions"><button id="ask-models" type="button">List models</button></div>'
  }
  return (
    '<div class="panel-actions"><select id="model-choice">' +
    state.models
      .map((route) => '<option value="' + escapeHtml(route) + '">' + text(route) + '</option>')
      .join('') +
    '</select><button id="use-model" class="primary" type="button">Use for later runs</button></div>' +
    '<div class="card-hint">the next run reads it from the settings file</div>'
  )
}

const panelBody = (settings: SettingsView): string =>
  panelRow('model', settings.model) +
  panelRow('effort', settings.effort === '' ? '(the provider chooses)' : settings.effort) +
  panelRow('cwd', settings.cwd) +
  panelRow('sessions', settings.sessionRoot) +
  panelRow('settings', settings.settingsPath === '' ? '(none)' : settings.settingsPath)

/** The settings sheet: what this run is configured with, and the one key a page may write. */
export const renderPanel = (state: WebState): string => {
  if (!state.panelOpen) return ''
  const settings = state.settings
  const body =
    settings === undefined
      ? '<div class="card-hint">reading the settings…</div>'
      : '<div class="panel-rows">' + panelBody(settings) + '</div>' + modelsHtml(state)
  return (
    '<section class="panel" role="dialog" aria-label="Settings">' +
    '<header class="panel-head"><span class="panel-title">Settings</span>' +
    '<button id="panel-close" type="button">Close</button></header>' +
    body +
    '</section>'
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
