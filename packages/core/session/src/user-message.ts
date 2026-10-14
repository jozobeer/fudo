import type { SessionEvent, UserMessageSource } from './events.ts'

/**
 * The newest user message of one source. The loop appends a message only when its
 * text changes, so reading it back keeps a resumed session from repeating it.
 */
export function lastMessageFrom(
  events: ReadonlyArray<SessionEvent>,
  source: UserMessageSource,
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'user/message' && event.data.source === source) return event.data.text
  }
  return undefined
}
