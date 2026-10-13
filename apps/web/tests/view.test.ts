import { describe, expect, test } from 'bun:test'
import { applyEvent, emptyConversation, type Conversation } from '@fudo/ui-view'
import type { UiEvent } from '@fudo/ui-protocol'
import { initialState, withConnection, withDraft } from '../client/state.ts'
import { escapeHtml, renderConversation, renderStatus } from '../client/view.ts'

let seq = 0
const session = (type: string, data: unknown): UiEvent => {
  seq += 1
  return { kind: 'session', event: { seq, time: seq, type, data } }
}
const fold = (events: ReadonlyArray<UiEvent>): Conversation =>
  events.reduce(applyEvent, emptyConversation)

describe('the browser view', () => {
  test('model output cannot inject markup', () => {
    const view = renderConversation(
      fold([session('user/message', { text: '<script>alert(1)</script>', source: 'user' })]),
    )
    expect(view).not.toContain('<script>')
    expect(view).toContain('&lt;script&gt;')
    expect(escapeHtml('a & b "c"')).toBe('a &amp; b &quot;c&quot;')
  })

  test('blocks render with their kind and tool state', () => {
    const view = renderConversation(
      fold([
        session('user/message', { text: 'do it', source: 'user' }),
        session('tool/call', { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' }),
        session('tool/result', {
          callId: 'c1',
          isError: true,
          content: [{ type: 'text', text: 'no' }],
        }),
      ]),
    )
    expect(view).toContain('class="block user"')
    expect(view).toContain('class="block tool error"')
    expect(view).toContain('bash')
  })

  test('a pending approval offers both answers and no question hides them', () => {
    const view = renderConversation(
      fold([
        session('turn/start', { turn: 1 }),
        session('safety/approval/requested', { callId: 'c1', tool: 'bash', reason: 'because' }),
      ]),
    )
    expect(view).toContain('data-call-id="c1"')
    expect(view).toContain('data-approve="true"')
    expect(view).toContain('data-approve="false"')
    expect(renderConversation(emptyConversation)).not.toContain('data-approve')
  })

  test('the status strip reports the connection and the next action', () => {
    expect(renderStatus(initialState)).toContain('reconnecting')
    const connected = withConnection(withDraft(initialState, 'hi'), true)
    expect(renderStatus(connected)).toContain('ready')
    expect(renderStatus(connected)).toContain('dot on')
  })
})
