import { Context } from 'effect'
import type { SessionPersistence } from './persistence.ts'

/** The persistence provider seam. `@jozo-harness/session-jsonl` provides it. */
export class SessionPersistenceService extends Context.Service<
  SessionPersistenceService,
  SessionPersistence
>()('jozo-harness/SessionPersistence') {}
