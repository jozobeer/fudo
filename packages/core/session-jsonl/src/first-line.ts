import { Effect } from 'effect'
import { stat } from 'node:fs/promises'
import { persistenceError } from './errors.ts'
import type { SessionError } from '@jozo-harness/session'

/** How much of a log is read to find its first line. */
export const HEADER_READ_BYTES = 64 * 1024

/**
 * The first line of a log, read without carrying the rest: a listing needs the
 * header, not the ten thousand events behind it. A first line longer than the
 * budget is refused rather than silently cut.
 */
export const readFirstLine = (
  path: string,
  maxBytes: number = HEADER_READ_BYTES,
): Effect.Effect<string, SessionError> =>
  Effect.gen(function* () {
    const info = yield* Effect.tryPromise({
      try: () => stat(path),
      catch: (cause) => persistenceError(`cannot look at ${path}`, cause),
    })
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(path).slice(0, maxBytes).text(),
      catch: (cause) => persistenceError(`cannot read ${path}`, cause),
    })
    const newline = text.indexOf('\n')
    if (newline >= 0) return text.slice(0, newline)
    if (info.size > maxBytes) {
      return yield* Effect.fail(
        persistenceError(`the first line of ${path} is longer than ${String(maxBytes)} bytes`),
      )
    }
    return text
  })
