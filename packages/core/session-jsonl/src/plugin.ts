import { SessionPersistenceService } from '@jozo-harness/session'
import type { Plugin } from '@jozo-harness/kernel'
import { Layer, Schema } from 'effect'
import { jsonlSessions } from './index.ts'

/** Loader definition for the JSONL session store. */
export const sessionJsonlPlugin: Plugin<
  { readonly root: string },
  SessionPersistenceService,
  never
> = {
  name: '@jozo-harness/session-jsonl',
  config: Schema.Struct({ root: Schema.String }),
  provides: [SessionPersistenceService],
  requires: [],
  layer: (config) => Layer.succeed(SessionPersistenceService, jsonlSessions({ root: config.root })),
}
