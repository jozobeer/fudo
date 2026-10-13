import { SessionPersistenceService } from '@fudo/session'
import type { Plugin } from '@fudo/kernel'
import { Layer, Schema } from 'effect'
import { jsonlSessions } from './index.ts'

/** Loader definition for the JSONL session store. */
export const sessionJsonlPlugin: Plugin<
  { readonly root: string },
  SessionPersistenceService,
  never
> = {
  name: '@fudo/session-jsonl',
  config: Schema.Struct({ root: Schema.String }),
  provides: [SessionPersistenceService],
  requires: [],
  layer: (config) => Layer.succeed(SessionPersistenceService, jsonlSessions({ root: config.root })),
}
