import type { UiEvent } from '@jozo-harness/ui-protocol'
import { applyEvent, emptyConversation, type Conversation } from '@jozo-harness/ui-view'

/** What the browser shows: the conversation, the socket state, and the draft. */
export interface WebState {
  readonly conversation: Conversation
  readonly connected: boolean
  readonly draft: string
}

export const initialState: WebState = {
  conversation: emptyConversation,
  connected: false,
  draft: '',
}

export const withConnection = (state: WebState, connected: boolean): WebState => ({
  ...state,
  connected,
})

export const withDraft = (state: WebState, draft: string): WebState => ({ ...state, draft })

export const applyUiEvent = (state: WebState, event: UiEvent): WebState => ({
  ...state,
  conversation: applyEvent(state.conversation, event),
})
