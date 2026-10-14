import type { SessionEvent } from './events.ts'

/**
 * The newest runtime snapshot in the log. The loop appends a snapshot only when the
 * rendered text differs, so reading it back keeps a resumed session from repeating it.
 */
export function lastRuntimeContext(events: ReadonlyArray<SessionEvent>): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'user/message' && event.data.source === 'runtime-context') {
      return event.data.text
    }
  }
  return undefined
}
