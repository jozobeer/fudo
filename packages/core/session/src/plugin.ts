import { Hooks, type Plugin } from '@jozo-harness/kernel'
import { Schema } from 'effect'
import { Sessions, sessionsFromServiceLayer } from './sessions.ts'
import { SessionPersistenceService } from './service.ts'

/** Loader definition for the session registry. */
export const sessionPlugin: Plugin<{}, Sessions, SessionPersistenceService | Hooks> = {
  name: '@jozo-harness/session',
  config: Schema.Struct({}),
  provides: [Sessions],
  requires: [SessionPersistenceService, Hooks],
  layer: () => sessionsFromServiceLayer,
}
