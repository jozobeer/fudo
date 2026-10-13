import type { SessionEvent } from './events.ts'

/**
 * The events a child session should start from: everything the parent has done,
 * except the last thing the user said (the child is given its own task instead).
 */
export const forkSeed = (events: ReadonlyArray<SessionEvent>): ReadonlyArray<SessionEvent> => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'user/message') return events.slice(0, index)
  }
  return [...events]
}
