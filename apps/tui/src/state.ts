import type { UiCommand, UiEvent } from '@fudo/ui-protocol'
import { applyEvent, emptyConversation, type Conversation, type NoticeLevel } from '@fudo/ui-view'
import {
  backspace,
  deleteForward,
  emptyEditor,
  historyNext,
  historyPrev,
  insert,
  moveEnd,
  moveHome,
  moveLeft,
  moveRight,
  recall,
  type EditorState,
} from './editor.ts'
import type { KeyEvent } from './keys.ts'

export interface TuiState {
  readonly title: string
  readonly conversation: Conversation
  readonly editor: EditorState
}

export const initialTuiState: TuiState = {
  title: 'fudo',
  conversation: emptyConversation,
  editor: emptyEditor,
}

export interface KeyOutcome {
  readonly state: TuiState
  readonly commands: ReadonlyArray<UiCommand>
  readonly exit: boolean
}

const unchanged = (state: TuiState, commands: ReadonlyArray<UiCommand> = []): KeyOutcome => ({
  state,
  commands,
  exit: false,
})

const isMovement = (key: KeyEvent): boolean =>
  key.kind === 'left' ||
  key.kind === 'right' ||
  key.kind === 'up' ||
  key.kind === 'down' ||
  key.kind === 'home' ||
  key.kind === 'end'

const editKey = (editor: EditorState, key: KeyEvent): EditorState => {
  switch (key.kind) {
    case 'char':
      return insert(editor, key.char)
    case 'backspace':
      return backspace(editor)
    case 'delete':
      return deleteForward(editor)
    default:
      return editor
  }
}

const moveKey = (editor: EditorState, key: KeyEvent): EditorState => {
  switch (key.kind) {
    case 'left':
      return moveLeft(editor)
    case 'right':
      return moveRight(editor)
    case 'home':
      return moveHome(editor)
    case 'end':
      return moveEnd(editor)
    case 'up':
      return historyPrev(editor)
    case 'down':
      return historyNext(editor)
    default:
      return editor
  }
}

const applyKey = (editor: EditorState, key: KeyEvent): EditorState =>
  isMovement(key) ? moveKey(editor, key) : editKey(editor, key)

const approveKey = (key: KeyEvent): boolean | undefined => {
  if (key.kind !== 'char') return undefined
  if (key.char === 'y' || key.char === 'Y') return true
  if (key.char === 'n' || key.char === 'N') return false
  return undefined
}

/** While an approval waits, y and n answer it and everything else is ignored. */
const approvalOutcome = (state: TuiState, key: KeyEvent): KeyOutcome | undefined => {
  const approval = state.conversation.approval
  if (approval === undefined) return undefined
  const approved = approveKey(key)
  if (approved !== undefined) {
    return unchanged(state, [{ kind: 'approve', callId: approval.callId, approved }])
  }
  if (key.kind === 'ctrl' && key.char === 'c') return unchanged(state, [{ kind: 'cancel' }])
  if (key.kind === 'ctrl' && key.char === 'd') return { state, commands: [], exit: true }
  return unchanged(state)
}

const controlOf = (key: KeyEvent): 'cancel' | 'exit' | undefined => {
  if (key.kind !== 'ctrl') return undefined
  if (key.char === 'c') return 'cancel'
  return key.char === 'd' ? 'exit' : undefined
}

const submitOutcome = (state: TuiState): KeyOutcome => {
  const text = state.editor.text
  if (text.trim() === '') return unchanged(state)
  return {
    state: { ...state, editor: recall(state.editor, text) },
    commands: [{ kind: 'submit', text }],
    exit: false,
  }
}

const answerOutcome = (state: TuiState, id: string): KeyOutcome => {
  const answer = state.editor.text
  if (answer.trim() === '') return unchanged(state)
  return {
    state: { ...state, editor: recall(state.editor, answer) },
    commands: [{ kind: 'answer', id, answer }],
    exit: false,
  }
}

export const handleEvent = (state: TuiState, event: UiEvent): TuiState => ({
  ...state,
  conversation: applyEvent(state.conversation, event),
})

/** Adds a notice the UI itself saw, such as a command that could not be sent. */
export const withNotice = (state: TuiState, level: NoticeLevel, text: string): TuiState => ({
  ...state,
  conversation: {
    ...state.conversation,
    blocks: [...state.conversation.blocks, { kind: 'notice', level, text }],
  },
})

const cancelOutcome = (state: TuiState): KeyOutcome =>
  state.conversation.running
    ? unchanged(state, [{ kind: 'cancel' }])
    : { state, commands: [], exit: true }

const enterOutcome = (state: TuiState): KeyOutcome => {
  const ask = state.conversation.ask
  return ask === undefined ? submitOutcome(state) : answerOutcome(state, ask.id)
}

/** One key, one decision: where the state goes, what to send, whether to stop. */
export const handleKey = (state: TuiState, key: KeyEvent): KeyOutcome => {
  const approval = approvalOutcome(state, key)
  if (approval !== undefined) return approval
  const control = controlOf(key)
  if (control === 'cancel') return cancelOutcome(state)
  if (control === 'exit') return { state, commands: [], exit: true }
  if (key.kind === 'enter') return enterOutcome(state)
  return unchanged({ ...state, editor: applyKey(state.editor, key) })
}
