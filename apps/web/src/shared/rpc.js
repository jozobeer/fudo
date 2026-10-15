import { UiCommandSchema, UiEventSchema } from '@jozo-harness/ui-protocol'
import { Rpc, RpcGroup } from 'effect/rpc'
import { Schema } from 'effect'
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
