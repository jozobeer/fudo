import type { SessionEvent } from './events.ts'
import { lastMessageFrom } from './user-message.ts'

/** The newest skill catalog in the log; the CLI publishes only when it changes. */
export const lastSkillCatalog = (events: ReadonlyArray<SessionEvent>): string | undefined =>
  lastMessageFrom(events, 'skill-catalog')
