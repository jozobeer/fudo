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

/** What a page may read about the run it is talking to. */
export const SettingsViewSchema = Schema.Struct({
  model: Schema.String,
  effort: Schema.String,
  settingsPath: Schema.String,
  cwd: Schema.String,
  sessionRoot: Schema.String,
})

/** What a page reads about the run behind it; the schema is the one source. */
export type SettingsView = typeof SettingsViewSchema.Type

export const SettingsRpc = Rpc.make('settings', {
  success: SettingsViewSchema,
  error: Schema.String,
})

/** Every model the provider offers, as provider/model routes. */
export const ModelsRpc = Rpc.make('models', {
  success: Schema.Array(Schema.String),
  error: Schema.String,
})

/** Writes the model into the settings file; the next run reads it there. */
export const SetModelRpc = Rpc.make('setModel', {
  payload: Schema.Struct({ model: Schema.String }),
  success: Schema.Boolean,
  error: Schema.String,
})

export const UiRpcs = RpcGroup.make(
  SessionsRpc,
  OpenRpc,
  UiCommandRpc,
  UiEventsRpc,
  SettingsRpc,
  ModelsRpc,
  SetModelRpc,
)

/**
 * Drops a phantom service requirement. `StreamChunkSchema` is annotated with
 * `Schema.Schema<StreamChunk>`, whose services erase to `unknown`, so every
 * client call of a stream RPC asks for services that do not exist. Nothing
 * here needs services at run time.
 */
export const withoutServices = <A, E>(effect: Effect.Effect<A, E, unknown>): Effect.Effect<A, E> =>
  effect as Effect.Effect<A, E>
