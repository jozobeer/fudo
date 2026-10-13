import { Hooks, type Plugin } from '@fudo/kernel'
import { Schema } from 'effect'
import { Tools, toolsLayer } from './registry.ts'

/** Loader definition for the tool registry. `bundle/base` lists it as `@fudo/tools`. */
export const toolsPlugin: Plugin<{}, Tools, Hooks> = {
  name: '@fudo/tools',
  config: Schema.Struct({}),
  provides: [Tools],
  requires: [Hooks],
  layer: () => toolsLayer,
}
