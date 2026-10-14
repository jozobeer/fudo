import { SessionError } from '@fudo/session'

/** A failure of the log store, as the file system reported it. */
export const persistenceError = (message: string, cause?: unknown): SessionError =>
  new SessionError({
    code: 'persistence',
    message: cause === undefined ? message : `${message}: ${String(cause)}`,
  })

/** The caller named a session this root does not hold. */
export const notFound = (id: string): SessionError =>
  new SessionError({ code: 'not-found', message: `no session ${id}` })

/** Whether an fs failure is a missing path rather than a broken one. */
export const isMissing = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ENOENT'
