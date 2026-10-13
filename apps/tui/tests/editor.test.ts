import { describe, expect, test } from 'bun:test'
import {
  backspace,
  emptyEditor,
  historyNext,
  historyPrev,
  insert,
  moveLeft,
  recall,
  type EditorState,
} from '../src/index.ts'

const type = (text: string, from: EditorState = emptyEditor): EditorState =>
  [...text].reduce((state, char) => insert(state, char), from)

describe('editor', () => {
  test('inserting and backspacing keeps the cursor with the text', () => {
    const typed = type('abc')
    expect(typed.text).toBe('abc')
    expect(typed.cursor).toBe(3)
    const erased = backspace(typed)
    expect(erased.text).toBe('ab')
    expect(erased.cursor).toBe(2)
  })

  test('moving left inserts in the middle', () => {
    const state = insert(moveLeft(type('ab')), 'x')
    expect(state.text).toBe('axb')
    expect(state.cursor).toBe(2)
  })

  test('history walks back to the draft', () => {
    let state = recall(recall(emptyEditor, 'first'), 'second')
    expect(state.history).toEqual(['first', 'second'])
    state = historyPrev(state)
    expect(state.text).toBe('second')
    state = historyPrev(state)
    expect(state.text).toBe('first')
    state = historyNext(historyNext(state))
    expect(state.text).toBe('')
    expect(state.historyIndex).toBeUndefined()
  })

  test('recall clears the input and appends to history', () => {
    const state = recall(type('hello'), 'hello')
    expect(state.text).toBe('')
    expect(state.cursor).toBe(0)
    expect(state.history).toEqual(['hello'])
  })
})
