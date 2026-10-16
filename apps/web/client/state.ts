import type { UiEvent, UiSessionEvent } from '@jozo-harness/ui-protocol'
import { applyEvent, emptyConversation, type Conversation } from '@jozo-harness/ui-view'
import type { SessionSummary, SettingsView } from '../src/shared/rpc.ts'
import { DEFAULT_THEME, type Theme } from './theme.ts'

/** What the header says about the session behind the page. */
export interface SessionInfo {
  readonly cwd: string
  readonly model: string
  readonly turns: number
}

const emptyInfo: SessionInfo = { cwd: '', model: '', turns: 0 }

/** What the browser shows: the conversation, the socket, the draft, and the sessions. */
export interface WebState {
  readonly conversation: Conversation
  readonly connected: boolean
  readonly draft: string
  readonly info: SessionInfo
  /** Every session the store holds, newest first, as the sidebar lists them. */
  readonly sessions: ReadonlyArray<SessionSummary>
  /** The session being read; '' until the page has opened one. */
  readonly sessionId: string
  /** Why the last move failed; shown until the page moves again. */
  readonly problem: string
  /** Which of the ways a page may be lit the reader chose. */
  readonly theme: Theme
  /** What the server says about this run; undefined until the page has read it. */
  readonly settings: SettingsView | undefined
  /** The provider's models, once the reader asked for them. */
  readonly models: ReadonlyArray<string>
  /** Whether the settings and the model list are on screen. */
  readonly panelOpen: boolean
}

export const initialState: WebState = {
  conversation: emptyConversation,
  connected: false,
  draft: '',
  info: emptyInfo,
  sessions: [],
  sessionId: '',
  problem: '',
  theme: DEFAULT_THEME,
  settings: undefined,
  models: [],
  panelOpen: false,
}

export const withConnection = (state: WebState, connected: boolean): WebState => ({
  ...state,
  connected,
})

export const withDraft = (state: WebState, draft: string): WebState => ({ ...state, draft })

export const withSessions = (state: WebState, items: ReadonlyArray<SessionSummary>): WebState => ({
  ...state,
  sessions: items,
})

export const withProblem = (state: WebState, problem: string): WebState => ({ ...state, problem })

export const withTheme = (state: WebState, theme: Theme): WebState => ({ ...state, theme })

export const withSettings = (state: WebState, settings: SettingsView): WebState => ({
  ...state,
  settings,
})

export const withModels = (state: WebState, models: ReadonlyArray<string>): WebState => ({
  ...state,
  models,
})

export const withPanel = (state: WebState, panelOpen: boolean): WebState => ({
  ...state,
  panelOpen,
})

/**
 * Reads one session: the conversation starts over because another log does, and
 * a session the store did not list (one just created) joins the sidebar.
 */
export const withSession = (state: WebState, summary: SessionSummary): WebState => {
  const known = state.sessions.some((item) => item.id === summary.id)
  return {
    ...state,
    sessions: known ? state.sessions : [...state.sessions, summary],
    sessionId: summary.id,
    conversation: emptyConversation,
    info: emptyInfo,
    problem: '',
  }
}

/** The event bodies arrive as unknown; a header shows nothing it could not read. */
const fieldOf = (data: unknown, key: string): unknown =>
  typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined

const withCwd = (info: SessionInfo, data: unknown): SessionInfo => {
  const cwd = fieldOf(data, 'cwd')
  return typeof cwd === 'string' ? { ...info, cwd } : info
}

const withModel = (info: SessionInfo, data: unknown): SessionInfo => {
  const provider = fieldOf(data, 'provider')
  const model = fieldOf(data, 'model')
  return typeof provider === 'string' && typeof model === 'string'
    ? { ...info, model: provider + '/' + model }
    : info
}

const withTurn = (info: SessionInfo, data: unknown): SessionInfo => {
  const turn = fieldOf(data, 'turn')
  return typeof turn === 'number' ? { ...info, turns: Math.max(info.turns, turn) } : info
}

/** The events the header reads, by name: one lookup instead of a chain of tests. */
const INFO_READERS: Readonly<Record<string, (info: SessionInfo, data: unknown) => SessionInfo>> = {
  'session/header': withCwd,
  'session/cwd/changed': withCwd,
  'request/header': withModel,
  'turn/start': withTurn,
}

const infoAfter = (info: SessionInfo, event: UiSessionEvent): SessionInfo => {
  const read = INFO_READERS[event.type]
  return read === undefined ? info : read(info, event.data)
}

export const applyUiEvent = (state: WebState, event: UiEvent): WebState => ({
  ...state,
  info: event.kind === 'session' ? infoAfter(state.info, event.event) : state.info,
  conversation: applyEvent(state.conversation, event),
})
