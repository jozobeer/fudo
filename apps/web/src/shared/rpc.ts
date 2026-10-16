import { UiCommandSchema, UiEventSchema } from '@jozo-harness/ui-protocol'
import { type Effect, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

/** A session as a page lists it: what the store holds, without reading its log. */
export const SessionSummarySchema = Schema.Struct({
  id: Schema.String,
  cwd: Schema.String,
  createdAt: Schema.Number,
  /** The first thing the human typed in that session; '' when the log holds none yet. */
  title: Schema.String,
})

/** The wire shape of one session summary; the store's own summary carries these fields. */
export type SessionSummary = typeof SessionSummarySchema.Type

/** What a page needs before it opens anything: the list, and where to start. */
export const SessionsRpc = Rpc.make('sessions', {
  success: Schema.Struct({
    initial: Schema.String,
    items: Schema.Array(SessionSummarySchema),
  }),
  error: Schema.String,
})

/** Opens one session: the named one, or a new one when no id is given. */
export const OpenRpc = Rpc.make('open', {
  payload: Schema.Struct({ sessionId: Schema.optionalKey(Schema.String) }),
  success: SessionSummarySchema,
  error: Schema.String,
})

/** One UI command, addressed to one session. Returns false when the core could not take it. */
export const UiCommandRpc = Rpc.make('command', {
  payload: Schema.Struct({ sessionId: Schema.String, command: UiCommandSchema }),
  success: Schema.Boolean,
})

/** Everything one session logs: history first, then live. */
export const UiEventsRpc = Rpc.make('events', {
  payload: Schema.Struct({ sessionId: Schema.String }),
  success: UiEventSchema,
  error: Schema.String,
  stream: true,
})

export const UiRpcs = RpcGroup.make(SessionsRpc, OpenRpc, UiCommandRpc, UiEventsRpc)

/**
 * Drops a phantom service requirement. `StreamChunkSchema` is annotated with
 * `Schema.Schema<StreamChunk>`, whose services erase to `unknown`, so every
 * client call of a stream RPC asks for services that do not exist. Nothing
 * here needs services at run time.
 */
export const withoutServices = <A, E>(effect: Effect.Effect<A, E, unknown>): Effect.Effect<A, E> =>
  effect as Effect.Effect<A, E>
