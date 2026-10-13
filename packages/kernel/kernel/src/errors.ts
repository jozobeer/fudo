import { Data } from 'effect'

export type PluginErrorCode =
  | 'unknown-plugin'
  | 'duplicate-plugin'
  | 'duplicate-provider'
  | 'missing-provider'
  | 'dependency-cycle'
  | 'config'

/** A failure caused by the plugin configuration, not by plugin code. */
export class PluginError extends Data.TaggedError('PluginError')<{
  readonly code: PluginErrorCode
  readonly message: string
  readonly pluginId?: string
  readonly service?: string
}> {}
