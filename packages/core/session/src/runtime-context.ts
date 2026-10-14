import type { SessionEvent } from './events.ts'
import { lastMessageFrom } from './user-message.ts'

/** The newest runtime snapshot in the log; the loop appends only when it changes. */
export const lastRuntimeContext = (events: ReadonlyArray<SessionEvent>): string | undefined =>
  lastMessageFrom(events, 'runtime-context')
