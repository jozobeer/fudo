import { describe, expect, test } from 'vitest'
import { applyEvent, emptyConversation, type Conversation } from '@jozo-harness/ui-view'
import type { UiEvent } from '@jozo-harness/ui-protocol'
import { escapeHtml } from '../src/ui/html.ts'
import {
  initialState,
  type WebState,
  withConnection,
  withDraft,
  withModels,
  withRun,
  withPane,
  withSession,
  withSessions,
  withSettings,
  withTheme,
} from '../src/ui/state.ts'
import {
  childSessionsOf,
  renderConversation,
  renderQueue,
  renderRail,
  renderSeat,
  renderContext,
  renderTakeover,
  whenOf,
  renderSessions,
  renderStatus,
} from '../client/view.ts'

const emptyRun = { goal: null, schedules: [], jobs: [], queued: [] }

const a = { id: 'a', cwd: '/work/one', createdAt: 1, title: 'count the files' }
const b = { id: 'b', cwd: '/work/two', createdAt: 2, title: '' }

let seq = 0
const session = (type: string, data: unknown): UiEvent => {
  seq += 1
  return { kind: 'session', event: { seq, time: seq, type, data } }
}
const fold = (events: ReadonlyArray<UiEvent>): Conversation =>
  events.reduce(applyEvent, emptyConversation)
const asked = [
  session('turn/start', { turn: 1 }),
  session('user/message', { text: 'do it', source: 'user' }),
  session('assistant/message', {
    provider: 'stub',
    model: 'm',
    content: [{ type: 'text', text: 'the **answer**\n\n```ts\nlet a = 1\n```' }],
    stream: [],
  }),
]

describe('the browser view', () => {
  test('model output cannot inject markup', () => {
    const view = renderConversation(
      fold([session('user/message', { text: '<script>alert(1)</script>', source: 'user' })]),
    )
    expect(view).not.toContain('<script>')
    expect(view).toContain('&lt;script&gt;')
    expect(escapeHtml('a & b "c"')).toBe('a &amp; b &quot;c&quot;')
  })

  test('an answer is marked up and a tool call becomes a card', () => {
    const view = renderConversation(
      fold([
        ...asked,
        session('tool/call', { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' }),
        session('tool/result', {
          callId: 'c1',
          isError: false,
          content: [{ type: 'text', text: 'a.ts\nb.ts' }],
        }),
      ]),
    )
    expect(view).toContain('<div class="body markdown"><p>the <strong>answer</strong></p>')
    expect(view).toContain('data-lang="ts"')
    expect(view).toContain('class="block tool done"')
    expect(view).toContain('class="tool-name">bash')
    expect(view).toContain('a.ts\nb.ts')
  })

  test('a failed call opens its body and a running one has none yet', () => {
    const failed = renderConversation(
      fold([
        session('tool/call', { callId: 'c1', name: 'bash', arguments: '{}' }),
        session('tool/result', {
          callId: 'c1',
          isError: true,
          content: [{ type: 'text', text: 'boom' }],
        }),
      ]),
    )
    expect(failed).toContain('class="tool-card" open')
    expect(failed).toContain('failed')
    const running = renderConversation(
      fold([session('tool/call', { callId: 'c1', name: 'bash', arguments: '{}' })]),
    )
    expect(running).toContain('class="block tool running"')
    expect(running).not.toContain('tool-output')
  })

  test('a pending approval offers both answers and a pending question its choices', () => {
    const waiting = (conversation: Conversation): WebState => ({ ...initialState, conversation })
    const approval = renderTakeover(
      waiting(
        fold([
          session('turn/start', { turn: 1 }),
          session('safety/approval/requested', { callId: 'c1', tool: 'bash', reason: 'because' }),
        ]),
      ),
    )
    expect(approval).toContain('data-call-id="c1"')
    expect(approval).toContain('data-approve="true"')
    expect(approval).toContain('data-approve="false"')
    expect(approval).toContain('Approve bash?')
    const asked = fold([
      session('interaction/ask/requested', {
        id: 'a1',
        question: 'which one?\n\n- x\n- y',
        options: ['x', 'y'],
      }),
    ])
    const ask = renderTakeover(waiting(asked))
    expect(ask).toContain('data-answer="x"')
    expect(ask).toContain('data-answer="y"')
    expect(ask).toContain('which one?')
    // The question itself stays in the conversation, where it was asked.
    expect(renderConversation(asked)).toContain('class="ask-question markdown"')
    expect(renderConversation(asked)).not.toContain('data-answer')
    expect(renderTakeover(initialState)).toBe('')
  })

  test('the sidebar lists the sessions and marks the one being read', () => {
    const view = renderSessions(withSession(withSessions(initialState, [a, b]), b))
    expect(view).toContain('data-session-id="a"')
    expect(view).toContain('data-session-id="b"')
    expect(view).toContain('class="session active" data-session-id="b"')
    expect(view).not.toContain('class="session active" data-session-id="a"')
    expect(view).toContain('count the files')
    expect(view).toContain('session-name">b<')
    expect(view).toContain('two')
    expect(renderSessions(initialState)).not.toContain('data-session-id')
  })

  test('the settings tab offers the three themes and marks the one in use', () => {
    const view = renderContext(withPane(withTheme(initialState, 'light'), { kind: 'settings' }))
    expect(view).toContain('data-theme="system"')
    expect(view).toContain('data-theme="dark"')
    expect(view).toContain('class="theme active" data-theme="light"')
    expect(view).not.toContain('class="theme active" data-theme="dark"')
    expect(view).toContain('id="settings"')
  })

  test('the rail says what the session works toward', () => {
    const running = withRun(initialState, {
      goal: { objective: 'ship the UI', phase: 'active', rounds: 2, maxRounds: 8 },
      schedules: [{ id: 's-1', when: 'every 60s', prompt: 'check the build', lastFiredAt: 0 }],
      jobs: [
        { id: 'j-1', command: 'sleep 5', running: true },
        { id: 'j-2', command: 'echo done', running: false },
      ],
      queued: [],
    })
    const view = renderContext(withPane(running, { kind: 'run' }))
    expect(view).toContain('ship the UI')
    expect(view).toContain('run-phase active')
    expect(view).toContain('2/8')
    expect(view).toContain('every 60s')
    expect(view).toContain('check the build')
    expect(view).toContain('run-job running')
    expect(view).toContain('data-job-id="j-1"')
    expect(view).toContain('sleep 5')
    expect(view).toContain('echo done')
    expect(
      renderContext(
        withPane(withRun(initialState, { goal: null, schedules: [], jobs: [], queued: [] }), {
          kind: 'run',
        }),
      ),
    ).toContain('no goal')
  })

  test('a question keeps its place in the conversation once it is answered', () => {
    const asked = fold([
      session('interaction/ask/requested', {
        id: 'a1',
        question: 'Leave plan mode?\n\n- one\n- two',
        options: ['approve', 'keep planning'],
      }),
    ])
    // Markdown, so a plan reads as a plan rather than one long line.
    expect(renderConversation(asked)).toContain('<li>one</li>')
    const settled = applyEvent(
      asked,
      session('interaction/ask/answered', { id: 'a1', answer: 'approve' }),
    )
    expect(renderConversation(settled)).toContain('answered: approve')
    expect(renderConversation(settled)).not.toContain('data-answer')
  })

  test('a session a subagent started is reachable from the rail', () => {
    const started = fold([
      session('tool/call', { callId: 'c1', name: 'subagent', arguments: '{"task":"look it up"}' }),
      session('tool/result', {
        callId: 'c1',
        isError: false,
        content: [{ type: 'text', text: 'the answer was 42\n\n[child session: child-1]' }],
      }),
      session('tool/call', { callId: 'c2', name: 'bash', arguments: '{}' }),
      session('tool/result', {
        callId: 'c2',
        isError: false,
        content: [{ type: 'text', text: 'not a child\n\n[child session: child-2]' }],
      }),
    ])
    expect(childSessionsOf(started.blocks)).toEqual(['child-1'])
    const view = renderContext(
      withPane({ ...initialState, conversation: started, run: emptyRun }, { kind: 'run' }),
    )
    expect(view).toContain('class="run-child" data-session-id="child-1"')
    expect(view).toContain('subagent · child-1')
    expect(childSessionsOf([])).toEqual([])
  })

  test('input the human typed while a turn runs waits above the composer', () => {
    const waiting = withRun(initialState, {
      goal: null,
      schedules: [],
      jobs: [],
      queued: ['one more thing'],
    })
    expect(renderQueue(waiting)).toContain('one more thing')
    expect(renderQueue(waiting)).toContain('queued')
    expect(renderQueue(initialState)).toBe('')
  })

  test('the pane keeps its tabs while its body comes and goes', () => {
    const hidden = renderContext(withPane(initialState, undefined))
    expect(hidden).toContain('id="settings"')
    expect(hidden).not.toContain('reading the settings')
    expect(renderContext(initialState)).toContain('Run')
    expect(renderContext(withPane(initialState, { kind: 'settings' }))).toContain(
      'reading the settings',
    )
  })

  test('a session nobody has asked anything shows what the page can do', () => {
    const welcome = renderConversation(emptyConversation)
    expect(welcome).toContain('New session')
    expect(welcome).toContain('/help')
    expect(welcome).toContain('asks before it runs')
    const said = fold([session('user/message', { text: 'hi', source: 'user' })])
    expect(renderConversation(said)).not.toContain('welcome-hints')
  })

  test('the rail says how long ago each session started', () => {
    const now = 1_700_000_000_000
    expect(whenOf(now - 30_000, now)).toBe('now')
    expect(whenOf(now - 5 * 60_000, now)).toBe('5m')
    expect(whenOf(now - 3 * 3_600_000, now)).toBe('3h')
    expect(whenOf(now - 30 * 3_600_000, now)).toBe('yesterday')
    expect(whenOf(now - 240 * 3_600_000, now)).not.toMatch(/^(now|\d+[mh]|yesterday)$/)
  })

  test('the rail foot says where the sessions it lists live', () => {
    const known = withSettings(initialState, {
      model: 'stub/model',
      effort: '',
      settingsPath: '/home/me/.jzh/config.yml',
      cwd: '/work',
      sessionRoot: '/home/me/.jzh/sessions',
    })
    expect(renderRail(known)).toContain('/home/me/.jzh/sessions')
    expect(renderRail(initialState)).toContain('store')
  })

  test('the composer seat names the model that answers', () => {
    expect(renderSeat(initialState)).toBe('')
    const known = { ...initialState, info: { cwd: '/work', model: 'stub/model', turns: 1 } }
    expect(renderSeat(known)).toContain('stub/model')
    expect(renderSeat(known)).toContain('id="seat-model"')
  })

  test('the ledger lists what each turn did and how long it took', () => {
    const state = withPane(
      {
        ...initialState,
        turns: [
          { turn: 1, startedAt: 0, endedAt: 1500, steps: 2, tools: 1, outcome: 'completed' },
          { turn: 2, startedAt: 1600, endedAt: undefined, steps: 1, tools: 0, outcome: '' },
        ],
      },
      { kind: 'trajectory' },
    )
    const view = renderContext(state)
    expect(view).toContain('turn 1')
    expect(view).toContain('1.5s')
    expect(view).toContain('2 steps · 1 calls')
    expect(view).toContain('completed')
    expect(view).toContain('class="turn open"')
    expect(view).toContain('running')
    expect(renderContext(withPane(initialState, { kind: 'trajectory' }))).toContain(
      'has not run a turn',
    )
  })

  test('a job opens with the output it kept, and a running one can be stopped', () => {
    const detail = { id: 'j-1', command: 'sleep 5', running: true, output: 'line one' }
    const view = renderContext(withPane(initialState, { kind: 'job', id: 'j-1', detail }))
    expect(view).toContain('sleep 5')
    expect(view).toContain('line one')
    expect(view).toContain('id="stop-job"')
    const finished = renderContext(
      withPane(initialState, { kind: 'job', id: 'j-1', detail: { ...detail, running: false } }),
    )
    expect(finished).not.toContain('id="stop-job"')
  })

  test('the sheet shows what the run is set to and asks before writing', () => {
    const settings = {
      model: 'stub/model',
      effort: 'high',
      settingsPath: '/home/me/.jzh/config.yml',
      cwd: '/work',
      sessionRoot: '/home/me/.jzh/sessions',
    }
    const read = withPane(withSettings(initialState, settings), { kind: 'settings' })
    const view = renderContext(read)
    expect(view).toContain('stub/model')
    expect(view).toContain('high')
    expect(view).toContain('/home/me/.jzh/sessions')
    expect(view).toContain('id="ask-models"')
    const listed = withModels(read, ['stub/model', 'stub/other'])
    expect(renderContext(listed)).toContain('<option value="stub/other">')
    expect(renderContext(listed)).toContain('id="use-model"')
  })

  test('the status strip reports the connection, where it runs and the next action', () => {
    expect(renderStatus(initialState)).toContain('reconnecting')
    const connected = withConnection(withDraft(initialState, 'hi'), true)
    expect(renderStatus(connected)).toContain('ready')
    expect(renderStatus(connected)).toContain('dot on')
  })
})
