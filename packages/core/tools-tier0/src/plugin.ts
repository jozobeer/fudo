import type { Plugin } from '@fudo/kernel'
import { Sandbox } from '@fudo/safety'
import { Context, Effect, Layer, Schema } from 'effect'
import type { ToolDefinition } from '@fudo/tools'
import { tier0Tools } from './index.ts'

/** The Tier 0 tool list, ready for whoever registers tools into the registry. */
export class Tier0Tools extends Context.Service<
  Tier0Tools,
  ReadonlyArray<ToolDefinition<any, any>>
>()('fudo/Tier0Tools') {}

/** Loader definition for the Tier 0 tools; bash uses the profile's sandbox. */
export const tier0Plugin: Plugin<{}, Tier0Tools, Sandbox> = {
  name: '@fudo/tools-tier0',
  config: Schema.Struct({}),
  provides: [Tier0Tools],
  requires: [Sandbox],
  layer: () =>
    Layer.effect(
      Tier0Tools,
      Effect.map(Sandbox, (sandbox) => tier0Tools(sandbox)),
    ),
}
