import { describe, expect, test } from 'vitest'
import { applyEvent, emptyConversation, type Conversation } from '../src/index.ts'
import type { UiSessionEvent } from '@jozo-harness/ui-protocol'

const event = (seq: number, type: string, data: unknown): UiSessionEvent =>
  ({ seq, time: seq, type, data }) as unknown as UiSessionEvent

const apply = (state: Conversation, ...events: ReadonlyArray<UiSessionEvent>): Conversation =>
  events.reduce((current, each) => applyEvent(current, { kind: 'session', event: each }), state)

describe('a command in the conversation', () => {
  test('shows what was typed and what came back', () => {
    const state = apply(
      emptyConversation,
      event(1, 'command/run', { commandId: 'cmd-1', name: 'status', input: '' }),
      event(2, 'command/done', {
        commandId: 'cmd-1',
        name: 'status',
        ok: true,
        text: 'session: s-1\nturns: 3',
      }),
    )

    expect(state.blocks).toEqual([
      { kind: 'notice', level: 'info', text: '/status' },
      { kind: 'notice', level: 'info', text: 'session: s-1\nturns: 3' },
    ])
  })

  test('an answer that failed is an error notice', () => {
    const state = apply(
      emptyConversation,
      event(1, 'command/done', { commandId: 'cmd-1', name: 'nope', ok: false, text: 'unknown' }),
    )

    expect(state.blocks).toEqual([{ kind: 'notice', level: 'error', text: 'unknown' }])
  })

  test('a command does not open a turn', () => {
    const state = apply(
      emptyConversation,
      event(1, 'command/run', { commandId: 'c', name: 'help', input: 'x' }),
    )

    expect(state.running).toBe(false)
    expect(state.blocks).toEqual([{ kind: 'notice', level: 'info', text: '/help x' }])
  })
})
