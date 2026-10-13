import { Schema } from 'effect'
import { Hooks, HooksLive } from './hooks.ts'
import type { Plugin } from './plugin.ts'

/** Loader definition for the hook registry itself. `bundle/base` lists it first. */
export const kernelPlugin: Plugin<{}, Hooks, never> = {
  name: '@fudo/kernel',
  config: Schema.Struct({}),
  provides: [Hooks],
  requires: [],
  layer: () => HooksLive,
}
