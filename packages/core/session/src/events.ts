import type { Emit } from '@fudo/kernel'
import type {
  AssistantStreamRecord,
  ContentBlock,
  LlmFailureData,
  LlmUsage,
  ToolSchema,
} from '@fudo/llm'
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

/**
 * Why a user message entered the log. The schema derives its literals from this
 * list, so an added source cannot be forgotten on the way to the log.
 */
export const USER_MESSAGE_SOURCES = [
  'user',
  'inject',
  'runtime-context',
  'skill-catalog',
  'goal-round',
] as const

export type UserMessageSource = (typeof USER_MESSAGE_SOURCES)[number]

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
  'compaction/prune': CompactionPrune
  'turn/start': { readonly turn: number }
  'turn/end': { readonly turn: number; readonly reason: TurnEndReason }
  'step/start': { readonly step: number }
  'step/end': { readonly step: number }
  'request/header': RequestHeaderData
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

/** Why a request header was written instead of reusing the one before it. */
export type RequestHeaderReason =
  /** The first header of the session. */
  | 'opened'
  /** The route, the parameters, or the tools differ from the last header. */
  | 'changed'

/**
 * What a request was assembled with. It is written once per request series: the
 * assembled tools and parameters are part of the log, so a request can be
 * reconstructed from the log alone, not only from the provider's answer.
 */
export interface RequestHeaderData {
  readonly provider: string
  readonly model: string
  readonly params: Readonly<Record<string, unknown>>
  /** Every tool the model could call, as the provider received it. */
  readonly tools: ReadonlyArray<ToolSchema>
  /** 1-based; a new series starts whenever the assembled request differs. */
  readonly series: number
  readonly reason: RequestHeaderReason
}

/** The content one request carries in place of a shadowed event's own content. */
export interface CompactReplacement {
  readonly seq: SessionSeq
  readonly content: ReadonlyArray<ContentBlock>
}

/**
 * The request stops carrying the content of these events and carries their
 * replacements instead. Log-only: no surface change, and the shadowed events keep
 * their own content, so the request is what the log says it was.
 */
export interface CompactionPrune {
  /** The events whose message content the request replaces, oldest first. */
  readonly shadowedSeqs: ReadonlyArray<SessionSeq>
  /** First and last of those seqs. */
  readonly shadowedRange: { readonly start: SessionSeq; readonly end: SessionSeq }
  /** The price of the content the request no longer carries, in UTF-8 bytes. */
  readonly shadowedBytes: number
  /** What the request carries for each shadowed seq. */
  readonly replacements: ReadonlyArray<CompactReplacement>
}
