import type { Conversation, ConversationBlock } from '@jozo-harness/ui-view'
import { plainText } from '@jozo-harness/ui-view'
import type { RunStateView, SessionSummary, SettingsView } from '../src/shared/rpc.ts'
import type { Sheet } from './state.ts'
import type { TurnView } from './trajectory.ts'
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

/** The ways to answer a question that is still waiting. */
const askActions = (block: Extract<ConversationBlock, { kind: 'ask' }>): string => {
  const id = escapeHtml(block.id)
  const options = block.options
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
    (options === '' ? '' : '<div class="ask-options">' + options + '</div>') +
    '<div class="card-hint">or type an answer and press Enter</div>'
  )
}

const askHtml = (block: Extract<ConversationBlock, { kind: 'ask' }>, pending: boolean): string =>
  '<article class="block ask"><div class="ask-question markdown">' +
  markdown(block.question) +
  '</div>' +
  (block.answer === undefined
    ? pending
      ? askActions(block)
      : ''
    : '<div class="ask-answer">answered: ' + text(block.answer) + '</div>') +
  '</article>'

const renderBlock = (block: ConversationBlock, pendingAsk: string | undefined): string => {
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
    case 'ask':
      return askHtml(block, block.id === pendingAsk)
    case 'notice':
      return '<article class="block notice ' + block.level + '">' + text(block.text) + '</article>'
  }
}

/** Rendered blocks of the conversation last painted; the array changes only when blocks do. */
let paintedBlocks: ReadonlyArray<ConversationBlock> | undefined
let paintedAsk: string | undefined
let paintedHtml = ''

const blocksHtml = (conversation: Conversation): string => {
  const pending = conversation.ask?.id
  if (conversation.blocks !== paintedBlocks || pending !== paintedAsk) {
    paintedBlocks = conversation.blocks
    paintedAsk = pending
    paintedHtml = conversation.blocks.map((block) => renderBlock(block, pending)).join('')
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

/** What a session that has not been asked anything says. */
const welcomeHtml = (): string =>
  '<section class="welcome"><h2>New session</h2>' +
  '<p class="welcome-lead">Nothing has been said yet. Type below and press Enter.</p>' +
  '<ul class="welcome-hints">' +
  '<li><code>/help</code> lists what a session answers; <code>/status</code> says where it stands</li>' +
  '<li>a shell command asks before it runs</li>' +
  '<li>the rail carries what the session works toward, and the sheets carry its turns, jobs and settings</li>' +
  '</ul></section>'

const isEmpty = (conversation: Conversation): boolean =>
  conversation.blocks.length === 0 &&
  conversation.live === '' &&
  conversation.approval === undefined &&
  conversation.ask === undefined

/** One HTML string for the whole conversation; the DOM layer replaces it. */
export const renderConversation = (conversation: Conversation): string => {
  if (isEmpty(conversation)) return welcomeHtml()
  const live =
    conversation.live === ''
      ? ''
      : '<article class="block assistant live"><div class="body markdown">' +
        markdown(conversation.live) +
        '</div></article>'
  return blocksHtml(conversation) + live + approvalHtml(conversation)
}

const basenameOf = (path: string): string => {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

/** How long ago a session started, the way a rail usually says it. */
export const whenOf = (at: number, now: number): string => {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return String(minutes) + 'm'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return String(hours) + 'h'
  if (hours < 48) return 'yesterday'
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const sessionRow = (state: WebState, summary: SessionSummary, now: number): string => {
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
    whenOf(summary.createdAt, now) +
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

/** The child session one `subagent` result names, as the pipeline writes it. */
const CHILD_MARKER = /\[child session: ([^\]\s]+)\]/g

/** The child sessions one block names; only a subagent result names any. */
const childrenOfBlock = (block: ConversationBlock): ReadonlyArray<string> =>
  block.kind === 'tool' && block.name === 'subagent'
    ? [...block.output.matchAll(CHILD_MARKER)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      )
    : []

/**
 * The child sessions this conversation started, oldest first, each named once.
 * The id is the one the subagent tool wrote into its own result, so the page
 * reads it rather than keeping a second ledger.
 */
export const childSessionsOf = (
  blocks: ReadonlyArray<ConversationBlock>,
): ReadonlyArray<string> => [...new Set(blocks.flatMap(childrenOfBlock))]

const childrenHtml = (blocks: ReadonlyArray<ConversationBlock>): string => {
  const children = childSessionsOf(blocks)
  return children.length === 0
    ? ''
    : '<ul class="run-children">' +
        children
          .map(
            (id) =>
              '<li><button class="run-child" data-session-id="' +
              escapeHtml(id) +
              '" type="button">subagent · ' +
              text(id.slice(0, 8)) +
              '</button></li>',
          )
          .join('') +
        '</ul>'
}

const jobsHtml = (jobs: RunStateView['jobs']): string =>
  jobs.length === 0
    ? ''
    : '<ul class="run-jobs">' +
      jobs
        .map(
          (job) =>
            '<li><button class="run-job ' +
            (job.running ? 'running' : 'done') +
            '" data-job-id="' +
            escapeHtml(job.id) +
            '" type="button"><span class="run-job-state">' +
            (job.running ? 'running' : 'done') +
            '</span><span class="run-job-command">' +
            text(job.command) +
            '</span></button></li>',
        )
        .join('') +
      '</ul>'

/** What the human typed while a turn was running: it waits above the composer. */
export const renderQueue = (state: WebState): string =>
  (state.run?.queued ?? [])
    .map(
      (message) =>
        '<div class="queued"><span class="queued-label">queued</span>' +
        '<span class="queued-text">' +
        text(message) +
        '</span></div>',
    )
    .join('')

/** What the session works toward: its goal, its standing schedules, and its background work. */
export const renderRun = (state: WebState): string => {
  const run = state.run
  return (
    '<span class="rail-label">run</span>' +
    (run === undefined
      ? '<div class="run-empty">reading…</div>'
      : goalHtml(run.goal) +
        schedulesHtml(run.schedules) +
        jobsHtml(run.jobs) +
        childrenHtml(state.conversation.blocks))
  )
}

/** The rail's foot: what the session works toward, how the page is lit, and the settings. */
export const renderRail = (state: WebState): string =>
  renderRun(state) +
  '<span class="rail-label">theme</span>' +
  themesHtml(state) +
  '<button id="settings" class="rail-button' +
  (state.sheet?.kind === 'settings' ? ' active' : '') +
  '" type="button">settings</button>' +
  '<button id="trajectory" class="rail-button' +
  (state.sheet?.kind === 'trajectory' ? ' active' : '') +
  '" type="button">trajectory</button>'

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

const settingsBody = (state: WebState): string =>
  state.settings === undefined
    ? '<div class="card-hint">reading the settings…</div>'
    : '<div class="panel-rows">' + panelBody(state.settings) + '</div>' + modelsHtml(state)

/** One background command with the output it has kept, and the way to stop it. */
const jobBody = (sheet: Extract<Sheet, { kind: 'job' }>): string => {
  const detail = sheet.detail
  if (detail === undefined) return '<div class="card-hint">reading the job…</div>'
  return (
    '<div class="panel-rows">' +
    panelRow('command', detail.command) +
    panelRow('state', detail.running ? 'running' : 'done') +
    '</div>' +
    '<pre class="job-output">' +
    text(detail.output === '' ? '(no output yet)' : detail.output) +
    '</pre>' +
    '<div class="panel-actions">' +
    (detail.running ? '<button id="stop-job" type="button">Stop</button>' : '') +
    '</div>'
  )
}

/** How long a turn took, as the log's own times say; '' while it is still open. */
const durationOf = (turn: TurnView): string => {
  if (turn.endedAt === undefined) return 'running'
  return ((turn.endedAt - turn.startedAt) / 1000).toFixed(1) + 's'
}

const turnRow = (turn: TurnView): string =>
  '<li class="turn' +
  (turn.endedAt === undefined ? ' open' : '') +
  '"><span class="turn-number">turn ' +
  String(turn.turn) +
  '</span><span class="turn-duration">' +
  durationOf(turn) +
  '</span><span class="turn-counts">' +
  String(turn.steps) +
  ' steps · ' +
  String(turn.tools) +
  ' calls</span><span class="turn-outcome">' +
  text(turn.outcome === '' ? '—' : turn.outcome) +
  '</span></li>'

/** The ledger: what each turn did, and how long it took. */
const trajectoryBody = (state: WebState): string =>
  state.turns.length === 0
    ? '<div class="card-hint">this session has not run a turn yet</div>'
    : '<ul class="turns">' + state.turns.map(turnRow).join('') + '</ul>'

const sheetTitle = (sheet: Sheet): string =>
  sheet.kind === 'settings'
    ? 'Settings'
    : sheet.kind === 'trajectory'
      ? 'Trajectory'
      : 'Job ' + sheet.id.slice(0, 8)

const sheetBody = (state: WebState, sheet: Sheet): string => {
  if (sheet.kind === 'settings') return settingsBody(state)
  return sheet.kind === 'trajectory' ? trajectoryBody(state) : jobBody(sheet)
}

/** The sheet on the right: what this run is set to, its turns, or one background command. */
export const renderSheet = (state: WebState): string => {
  const sheet = state.sheet
  if (sheet === undefined) return ''
  const title = sheetTitle(sheet)
  return (
    '<section class="panel" role="dialog" aria-label="' +
    escapeHtml(title) +
    '"><header class="panel-head"><span class="panel-title">' +
    text(title) +
    '</span><button id="panel-close" type="button">Close</button></header>' +
    sheetBody(state, sheet) +
    '</section>'
  )
}

/** The left rail: every session the store holds, the one on screen marked. */
export const renderSessions = (state: WebState, now: number = Date.now()): string =>
  state.sessions.map((summary) => sessionRow(state, summary, now)).join('')

/** The seat at the composer: which model answers, and the way to the sheet that changes it. */
export const renderSeat = (state: WebState): string =>
  state.info.model === ''
    ? ''
    : '<button id="seat-model" class="seat-chip" type="button" title="the model this run uses">' +
      text(state.info.model) +
      '</button>'

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
    '<span class="hint' +
    (state.problem === '' ? '' : ' error') +
    '">' +
    text(hintOf(state)) +
    '</span>'
  )
}
