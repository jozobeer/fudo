import { Data } from 'effect'

export type SessionErrorCode = 'not-serializable' | 'not-found' | 'persistence'

/** A failure of the session log or its persistence. */
export class SessionError extends Data.TaggedError('SessionError')<{
  readonly code: SessionErrorCode
  readonly message: string
}> {}
