import type { Context, Layer, Schema } from 'effect'
import type { PluginError } from './errors.ts'

/**
 * A unit that the loader assembles into the application layer.
 *
 * `provides` and `requires` are the runtime view of the same services that
 * `layer` mentions in its type, because the loader resolves dependencies after
 * the types are erased.
 */
export interface Plugin<Config, Provides, Requires> {
  readonly name: string
  readonly config: Schema.Schema<Config>
  readonly provides: ReadonlyArray<Context.Key<Provides, any>>
  readonly requires: ReadonlyArray<Context.Key<Requires, any>>
  readonly layer: (config: Config) => Layer.Layer<Provides, PluginError, Requires>
}
