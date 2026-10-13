import {
  registerSessionEventSchemas,
  type SessionEventSchemaMap,
  type UserMessageSource,
} from '@fudo/session'
import { Schema } from 'effect'

/** Which boundary picks up a queued message. */
export type InboxTarget = 'next-turn' | 'next-step'

/** One message waiting for an agent. */
export interface UserMessage {
  readonly text: string
  readonly source: UserMessageSource
}

declare module '@fudo/session/events' {
  interface SessionEventMap {
    'agent/inbox/queued': { readonly target: InboxTarget; readonly message: UserMessage }
    'agent/inbox/claimed': { readonly target: InboxTarget; readonly message: UserMessage }
  }
}

const UserMessageSchema = Schema.Struct({
  text: Schema.String,
  source: Schema.Literals(['user', 'inject', 'runtime-context']),
})

const InboxEventDataSchema = Schema.Struct({
  target: Schema.Literals(['next-turn', 'next-step']),
  message: UserMessageSchema,
})

/** Schemas for the session events this package adds. */
export const inboxEventSchemas: SessionEventSchemaMap = new Map<string, Schema.Schema<unknown>>([
  ['agent/inbox/queued', InboxEventDataSchema],
  ['agent/inbox/claimed', InboxEventDataSchema],
])

// Logs written here stay readable by every provider, not only by callers that
// pass the map explicitly.
registerSessionEventSchemas(inboxEventSchemas)
