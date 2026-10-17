import { type SessionError, titleOfRecord } from '@jozo-harness/session'
import { Effect } from 'effect'
import { persistenceError } from './errors.ts'
import { readHead } from './head.ts'

export { TITLE_MAX_CHARS } from '@jozo-harness/session'

/** How much of a log is read to find the first thing the human typed. */
export const TITLE_READ_BYTES = 64 * 1024

/** The title one line of a log carries, when that line is the human's own message. */
const titleOfLine = (line: string): string | undefined => {
  // Most lines are not the one: this spares a parse per event.
  if (!line.includes('"user/message"')) return undefined
  try {
    const record = JSON.parse(line) as { readonly type?: unknown; readonly data?: unknown }
    return titleOfRecord(record.type, record.data)
  } catch {
    return undefined // a torn line is not a title; the next one may be
  }
}

/**
 * The first user message of a log, read without carrying the rest: a listing names
 * a session without reading the ten thousand events behind it. A log whose first
 * words sit past the budget stays unnamed rather than read whole.
 */
export const readTitle = (
  path: string,
  maxBytes: number = TITLE_READ_BYTES,
): Effect.Effect<string, SessionError> =>
  Effect.gen(function* () {
    const text = yield* Effect.tryPromise({
      try: () => readHead(path, maxBytes),
      catch: (cause) => persistenceError(`cannot read ${path}`, cause),
    })
    for (const line of text.split('\n')) {
      const title = titleOfLine(line)
      if (title !== undefined) return title
    }
    return ''
  })
