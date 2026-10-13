import type { Plugin } from '@fudo/kernel'
import { Context, Layer, Schema } from 'effect'

export interface McpServerConfig {
  readonly command: ReadonlyArray<string>
  readonly prefix?: string
}

/** The MCP servers the profile asked for; the caller starts and registers them. */
export class McpServers extends Context.Service<McpServers, ReadonlyArray<McpServerConfig>>()(
  'fudo/McpServers',
) {}

export const mcpPlugin: Plugin<McpServerConfig, McpServers, never> = {
  name: '@fudo/mcp',
  config: Schema.Struct({
    command: Schema.Array(Schema.String),
    prefix: Schema.optionalKey(Schema.String),
  }),
  provides: [McpServers],
  requires: [],
  layer: (config) => Layer.succeed(McpServers, [config]),
}
