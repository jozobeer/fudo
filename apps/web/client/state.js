import { applyEvent, emptyConversation } from '@fudo/ui-view'
export const initialState = {
  conversation: emptyConversation,
  connected: false,
  draft: '',
}
export const withConnection = (state, connected) => ({
  ...state,
  connected,
})
export const withDraft = (state, draft) => ({ ...state, draft })
export const applyUiEvent = (state, event) => ({
  ...state,
  conversation: applyEvent(state.conversation, event),
})
