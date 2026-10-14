import type { RequestHeaderData, SessionEvent } from './events.ts'

/**
 * The newest request header in the log, or undefined before the first request.
 * The loop compares against it, so an unchanged request never restates its header.
 */
export function lastRequestHeader(
  events: ReadonlyArray<SessionEvent>,
): RequestHeaderData | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'request/header') return event.data
  }
  return undefined
}
