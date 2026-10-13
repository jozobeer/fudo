import type { SessionEvent, SessionHeader } from './events.ts'

/** The working directory in force: the newest change, or the header's. */
export const cwdOf = (events: ReadonlyArray<SessionEvent>, header: SessionHeader): string => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'session/cwd/changed') return event.data.cwd
  }
  return header.cwd
}
