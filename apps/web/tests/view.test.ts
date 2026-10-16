import { describe, expect, test } from 'bun:test'
import { applyEvent, emptyConversation, type Conversation } from '@jozo-harness/ui-view'
import type { UiEvent } from '@jozo-harness/ui-protocol'
import { escapeHtml } from '../client/html.ts'
import {
  initialState,
  withConnection,
  withDraft,
  withSession,
  withSessions,
} from '../client/state.ts'
import { renderConversation, renderSessions, renderStatus } from '../client/view.ts'

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
    const approval = renderConversation(
      fold([
        session('turn/start', { turn: 1 }),
        session('safety/approval/requested', { callId: 'c1', tool: 'bash', reason: 'because' }),
      ]),
    )
    expect(approval).toContain('data-call-id="c1"')
    expect(approval).toContain('data-approve="true"')
    expect(approval).toContain('data-approve="false"')
    const ask = renderConversation(
      fold([
        session('interaction/ask/requested', { id: 'a1', question: 'which?', options: ['x', 'y'] }),
      ]),
    )
    expect(ask).toContain('data-answer="x"')
    expect(ask).toContain('data-answer="y"')
    expect(renderConversation(emptyConversation)).not.toContain('data-approve')
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

  test('the status strip reports the connection, where it runs and the next action', () => {
    expect(renderStatus(initialState)).toContain('reconnecting')
    const connected = withConnection(withDraft(initialState, 'hi'), true)
    expect(renderStatus(connected)).toContain('ready')
    expect(renderStatus(connected)).toContain('dot on')
  })
})
