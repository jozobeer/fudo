import { UiCommandSchema, UiEventSchema } from '@jozo-harness/ui-protocol'
import { type Effect, Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

/** One UI command. Returns false when the core could not take it. */
export const UiCommandRpc = Rpc.make('command', {
  payload: UiCommandSchema,
  success: Schema.Boolean,
})

/** Everything the UI renders: history first, then live. */
export const UiEventsRpc = Rpc.make('events', {
  success: UiEventSchema,
  stream: true,
})

export const UiRpcs = RpcGroup.make(UiCommandRpc, UiEventsRpc)

/**
 * Drops a phantom service requirement. `StreamChunkSchema` is annotated with
 * `Schema.Schema<StreamChunk>`, whose services erase to `unknown`, so every
 * client call of a stream RPC asks for services that do not exist. Nothing
 * here needs services at run time.
 */
export const withoutServices = <A, E>(effect: Effect.Effect<A, E, unknown>): Effect.Effect<A, E> =>
  effect as Effect.Effect<A, E>
