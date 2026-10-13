export interface EditorState {
  readonly text: string
  /** Code-unit offset; movement keeps surrogate pairs whole. */
  readonly cursor: number
  readonly history: ReadonlyArray<string>
  /** undefined while editing the line that is not from history. */
  readonly historyIndex: number | undefined
  readonly draft: string
}

export const emptyEditor: EditorState = {
  text: '',
  cursor: 0,
  history: [],
  historyIndex: undefined,
  draft: '',
}

const HISTORY_LIMIT = 100

const previousOffset = (text: string, cursor: number): number => {
  if (cursor <= 0) return 0
  const unit = text.charCodeAt(cursor - 1)
  return unit >= 0xdc00 && unit <= 0xdfff ? Math.max(0, cursor - 2) : cursor - 1
}

const nextOffset = (text: string, cursor: number): number => {
  if (cursor >= text.length) return text.length
  const unit = text.charCodeAt(cursor)
  return unit >= 0xd800 && unit <= 0xdbff ? Math.min(text.length, cursor + 2) : cursor + 1
}

export const insert = (state: EditorState, value: string): EditorState => ({
  ...state,
  text: state.text.slice(0, state.cursor) + value + state.text.slice(state.cursor),
  cursor: state.cursor + value.length,
  historyIndex: undefined,
})

export const backspace = (state: EditorState): EditorState => {
  const start = previousOffset(state.text, state.cursor)
  if (start === state.cursor) return state
  return {
    ...state,
    text: state.text.slice(0, start) + state.text.slice(state.cursor),
    cursor: start,
    historyIndex: undefined,
  }
}

export const deleteForward = (state: EditorState): EditorState => {
  const end = nextOffset(state.text, state.cursor)
  if (end === state.cursor) return state
  return {
    ...state,
    text: state.text.slice(0, state.cursor) + state.text.slice(end),
    historyIndex: undefined,
  }
}

export const moveLeft = (state: EditorState): EditorState => ({
  ...state,
  cursor: previousOffset(state.text, state.cursor),
})

export const moveRight = (state: EditorState): EditorState => ({
  ...state,
  cursor: nextOffset(state.text, state.cursor),
})

export const moveHome = (state: EditorState): EditorState => ({ ...state, cursor: 0 })

export const moveEnd = (state: EditorState): EditorState => ({
  ...state,
  cursor: state.text.length,
})

export const historyPrev = (state: EditorState): EditorState => {
  if (state.history.length === 0) return state
  const index =
    state.historyIndex === undefined
      ? state.history.length - 1
      : Math.max(0, state.historyIndex - 1)
  const text = state.history[index] ?? ''
  return { ...state, historyIndex: index, text, cursor: text.length }
}

export const historyNext = (state: EditorState): EditorState => {
  if (state.historyIndex === undefined) return state
  const next = state.historyIndex + 1
  if (next >= state.history.length) {
    return { ...state, historyIndex: undefined, text: state.draft, cursor: state.draft.length }
  }
  const text = state.history[next] ?? ''
  return { ...state, historyIndex: next, text, cursor: text.length }
}

/** Clears the input after it was sent, remembering it for the up arrow. */
export const recall = (state: EditorState, sent: string): EditorState => ({
  text: '',
  cursor: 0,
  history: [...state.history, sent].slice(-HISTORY_LIMIT),
  historyIndex: undefined,
  draft: '',
})
