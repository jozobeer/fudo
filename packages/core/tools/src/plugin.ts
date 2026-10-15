import { Hooks, type Plugin } from '@jozo-harness/kernel'
import { Schema } from 'effect'
import { Tools, toolsLayer } from './registry.ts'

/** Loader definition for the tool registry. `bundle/base` lists it as `@jozo-harness/tools`. */
export const toolsPlugin: Plugin<{}, Tools, Hooks> = {
  name: '@jozo-harness/tools',
  config: Schema.Struct({}),
  provides: [Tools],
  requires: [Hooks],
  layer: () => toolsLayer,
}
