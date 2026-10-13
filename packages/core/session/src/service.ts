import { Context } from 'effect'
import type { SessionPersistence } from './persistence.ts'

/** The persistence provider seam. `@fudo/session-jsonl` provides it. */
export class SessionPersistenceService extends Context.Service<
  SessionPersistenceService,
  SessionPersistence
>()('fudo/SessionPersistence') {}
