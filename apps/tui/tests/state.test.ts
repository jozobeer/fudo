import { describe, expect, test } from 'vitest'
import { emptyConversation, type Conversation } from '@jozo-harness/ui-view'
import type { UiEvent } from '@jozo-harness/ui-protocol'
import {
  emptyEditor,
  insert,
  initialTuiState,
  handleEvent,
  handleKey,
  TAIL,
  type TuiState,
} from '../src/index.ts'

const conversation = (partial: Partial<Conversation>): Conversation => ({
  ...emptyConversation,
  ...partial,
})
const state = (partial: Partial<TuiState> = {}): TuiState => ({ ...initialTuiState, ...partial })
const typed = (text: string) =>
  Array.from(text).reduce((editor, char) => insert(editor, char), emptyEditor)

let seq = 0
const session = (type: string, data: unknown): UiEvent => {
  seq += 1
  return { kind: 'session', event: { seq, time: seq, type, data } }
}

describe('tui state', () => {
  test('enter submits the typed line and clears it', () => {
    const outcome = handleKey(state({ editor: typed('do it') }), { kind: 'enter' })
    expect(outcome.commands).toEqual([{ kind: 'submit', text: 'do it' }])
    expect(outcome.state.editor.text).toBe('')
    expect(outcome.state.editor.history).toEqual(['do it'])
    expect(outcome.exit).toBe(false)
  })

  test('enter on an empty line does nothing', () => {
    expect(handleKey(state(), { kind: 'enter' }).commands).toEqual([])
  })

  test('y and n answer a pending approval; other keys are ignored', () => {
    const pending = state({
      conversation: conversation({
        approval: { callId: 'c1', tool: 'bash', reason: 'outside the preset' },
      }),
    })
    expect(handleKey(pending, { kind: 'char', char: 'y' }).commands).toEqual([
      { kind: 'approve', callId: 'c1', approved: true },
    ])
    expect(handleKey(pending, { kind: 'char', char: 'n' }).commands).toEqual([
      { kind: 'approve', callId: 'c1', approved: false },
    ])
    expect(handleKey(pending, { kind: 'char', char: 'x' }).commands).toEqual([])
    expect(handleKey(pending, { kind: 'enter' }).commands).toEqual([])
  })

  test('enter answers a pending question instead of submitting', () => {
    const pending = state({
      conversation: conversation({ ask: { id: 'a1', question: 'which?', options: [] } }),
      editor: typed('the second'),
    })
    expect(handleKey(pending, { kind: 'enter' }).commands).toEqual([
      { kind: 'answer', id: 'a1', answer: 'the second' },
    ])
  })

  test('ctrl-c cancels a running turn and exits when idle', () => {
    const running = handleKey(state({ conversation: conversation({ running: true }) }), {
      kind: 'ctrl',
      char: 'c',
    })
    expect(running.commands).toEqual([{ kind: 'cancel' }])
    expect(running.exit).toBe(false)
    expect(handleKey(state(), { kind: 'ctrl', char: 'c' }).exit).toBe(true)
  })

  test('ctrl-d exits', () => {
    expect(handleKey(state(), { kind: 'ctrl', char: 'd' }).exit).toBe(true)
  })

  test('events fold into the conversation', () => {
    const next = handleEvent(state(), session('turn/start', { turn: 1 }))
    expect(next.conversation.running).toBe(true)
  })

  test('editing keys change the editor', () => {
    const outcome = handleKey(state({ editor: typed('ab') }), { kind: 'left' })
    expect(outcome.state.editor.cursor).toBe(1)
    const inserted = handleKey(outcome.state, { kind: 'char', char: 'x' })
    expect(inserted.state.editor.text).toBe('axb')
  })

  test('submitting and answering return the window to the tail', () => {
    const pinned = { kind: 'pinned', top: 0 } as const
    expect(
      handleKey(state({ editor: typed('do it'), scroll: pinned }), { kind: 'enter' }).state.scroll,
    ).toEqual(TAIL)
    const asking = state({
      conversation: conversation({ ask: { id: 'a1', question: 'which?', options: [] } }),
      editor: typed('the second'),
      scroll: pinned,
    })
    expect(handleKey(asking, { kind: 'enter' }).state.scroll).toEqual(TAIL)
  })

  test('a blocking question pulls a pinned window back to the tail', () => {
    const pinned = state({ scroll: { kind: 'pinned', top: 0 } })
    const approval = handleEvent(
      pinned,
      session('safety/approval/requested', { callId: 'c1', tool: 'bash', reason: 'x' }),
    )
    const ask = handleEvent(
      pinned,
      session('interaction/ask/requested', { id: 'a1', question: 'which?', options: [] }),
    )
    expect(approval.scroll).toEqual(TAIL)
    expect(ask.scroll).toEqual(TAIL)
  })

  test('output arriving below a pinned window leaves it where it is', () => {
    const pinned = state({ scroll: { kind: 'pinned', top: 3 } })
    const next = handleEvent(
      pinned,
      session('assistant/message', {
        provider: 'stub',
        model: 'm',
        content: [{ type: 'text', text: 'more' }],
        stream: [],
      }),
    )
    expect(next.scroll).toEqual({ kind: 'pinned', top: 3 })
  })
})
