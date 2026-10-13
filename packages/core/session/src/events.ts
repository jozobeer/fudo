import type { Emit } from '@fudo/kernel'
import type { AssistantStreamRecord, ContentBlock, LlmFailureData, LlmUsage } from '@fudo/llm'
import type { Session } from './session.ts'

export type SessionSeq = number
export type SessionId = string

export const SESSION_FORMAT_VERSION = 1

/** The first event of every log. */
export interface SessionHeader {
  readonly formatVersion: number
  readonly createdAt: number
  readonly cwd: string
}

export type TurnCancelCause = 'user' | 'shutdown' | 'parent-cancelled'

/** Reasons a turn can end. Plugins add their own by declaration merging. */
export interface TurnEndReasonMap {
  completed: { readonly kind: 'completed' }
  cancelled: { readonly kind: 'cancelled'; readonly cause: TurnCancelCause }
  error: { readonly kind: 'error'; readonly failure: LlmFailureData }
}

export type TurnEndReason = TurnEndReasonMap[keyof TurnEndReasonMap]

/** Why a user message entered the log. */
export type UserMessageSource = 'user' | 'inject' | 'runtime-context'

export interface AssistantMessageData {
  readonly provider: string
  readonly model: string
  readonly content: ReadonlyArray<ContentBlock>
  readonly usage?: LlmUsage
  readonly replayState?: unknown
  readonly stream: ReadonlyArray<AssistantStreamRecord>
}

/** An attempt that did not become history. */
export interface AssistantAttemptData {
  readonly provider: string
  readonly model: string
  readonly failure: LlmFailureData
  readonly stream: ReadonlyArray<AssistantStreamRecord>
}

/** Every event the S1 kernel and its packages log. Plugins extend this interface. */
export interface SessionEventMap {
  'session/header': SessionHeader
  'session/cwd/changed': CwdChanged
  'turn/start': { readonly turn: number }
  'turn/end': { readonly turn: number; readonly reason: TurnEndReason }
  'step/start': { readonly step: number }
  'step/end': { readonly step: number }
  'request/header': {
    readonly provider: string
    readonly model: string
    readonly params: Readonly<Record<string, unknown>>
  }
  'system/message': { readonly text: string }
  'user/message': { readonly text: string; readonly source: UserMessageSource }
  'assistant/message': AssistantMessageData
  'assistant/attempt': AssistantAttemptData
  'tool/call': { readonly callId: string; readonly name: string; readonly arguments: string }
  'tool/result': {
    readonly callId: string
    readonly isError: boolean
    readonly content: ReadonlyArray<ContentBlock>
  }
}

export type SessionEventType = keyof SessionEventMap

/** One append-only log record. `type` discriminates so `ev.data` narrows without a cast. */
export type SessionEvent = {
  readonly [K in SessionEventType]: {
    readonly seq: SessionSeq
    readonly time: number
    readonly type: K
    readonly data: SessionEventMap[K]
    readonly ignorable?: true
  }
}[SessionEventType]

declare module '@fudo/kernel/hook' {
  interface HookMap {
    'session/event': Emit<(event: SessionEvent, session: Session) => void>
  }
}

/** The working directory moved. The newest one wins. */
export interface CwdChanged {
  readonly cwd: string
}
