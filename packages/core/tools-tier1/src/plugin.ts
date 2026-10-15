import type { Plugin } from '@jozo-harness/kernel'
import { Ask } from '@jozo-harness/safety'
import { Context, Effect, Layer, Schema } from 'effect'
import type { ToolDefinition } from '@jozo-harness/tools'
import { tier1Tools } from './index.ts'

/** The Tier 1 tool list, ready for whoever registers tools into the registry. */
export class Tier1Tools extends Context.Service<
  Tier1Tools,
  ReadonlyArray<ToolDefinition<any, any>>
>()('jozo-harness/Tier1Tools') {}

/** Loader definition for the Tier 1 tools; the ask tool uses the ask holder. */
export const tier1Plugin: Plugin<{}, Tier1Tools, Ask> = {
  name: '@jozo-harness/tools-tier1',
  config: Schema.Struct({}),
  provides: [Tier1Tools],
  requires: [Ask],
  layer: () =>
    Layer.effect(
      Tier1Tools,
      Effect.map(Ask, (ask) => tier1Tools(ask)),
    ),
}
