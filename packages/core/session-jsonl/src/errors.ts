import { SessionError } from '@jozo-harness/session'

/** What a cause adds to a message: an Error's words, a primitive as itself, an object as JSON. */
const describe = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'object' && cause !== null) return JSON.stringify(cause)
  return String(cause)
}

/** A failure of the log store, as the file system reported it. */
export const persistenceError = (message: string, cause?: unknown): SessionError =>
  new SessionError({
    code: 'persistence',
    message: cause === undefined ? message : `${message}: ${describe(cause)}`,
  })

/** The caller named a session this root does not hold. */
export const notFound = (id: string): SessionError =>
  new SessionError({ code: 'not-found', message: `no session ${id}` })

/** Whether an fs failure is a missing path rather than a broken one. */
export const isMissing = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ENOENT'
