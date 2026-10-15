import { describe, expect, test } from 'bun:test'
import { emptyConversation, type Conversation } from '@jozo-harness/ui-view'
import type { UiEvent } from '@jozo-harness/ui-protocol'
import {
  emptyEditor,
  insert,
  initialTuiState,
  handleEvent,
  handleKey,
  type TuiState,
} from '../src/index.ts'

const conversation = (partial: Partial<Conversation>): Conversation => ({
  ...emptyConversation,
  ...partial,
})
const state = (partial: Partial<TuiState> = {}): TuiState => ({ ...initialTuiState, ...partial })
const typed = (text: string) =>
  [...text].reduce((editor, char) => insert(editor, char), emptyEditor)

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
})
