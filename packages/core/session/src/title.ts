import type { SessionEvent } from './events.ts'

/** How long a title may be, in code units. */
export const TITLE_MAX_CHARS = 120

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** One line, trimmed, and no longer than a title should be. */
export const shortenTitle = (text: string): string => {
  const line = oneLine(text)
  return line.length <= TITLE_MAX_CHARS ? line : line.slice(0, TITLE_MAX_CHARS - 1) + '…'
}

/**
 * The title a decoded log record carries, or undefined when the record is not the
 * human's own message. The body arrives as unknown: a record that does not read as
 * one is not a title, and the next one may be.
 */
export const titleOfRecord = (type: unknown, data: unknown): string | undefined => {
  if (type !== 'user/message') return undefined
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as { readonly source?: unknown; readonly text?: unknown }
  if (record.source !== 'user' || typeof record.text !== 'string') return undefined
  return shortenTitle(record.text)
}

/** The first message the human sent, as the log holds it; '' when there is none. */
export const titleOf = (events: ReadonlyArray<SessionEvent>): string => {
  for (const event of events) {
    const title = titleOfRecord(event.type, event.data)
    if (title !== undefined) return title
  }
  return ''
}
