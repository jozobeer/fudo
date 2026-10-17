import { describe, expect, test } from 'vitest'
import { Context, Layer, Schema } from 'effect'
import { renderPluginKeys, type Plugin } from '../src/index.ts'

class ConfigKeysService extends Context.Service<ConfigKeysService, { readonly id: string }>()(
  'test/ConfigKeys',
) {}

const serviceLayer = Layer.succeed(ConfigKeysService, { id: 'keys' })

const keysConfig = Schema.Struct({
  preset: Schema.Literals(['read-only', 'full']),
  baseUrl: Schema.String,
  roots: Schema.optionalKey(Schema.Array(Schema.String)),
  anything: Schema.optionalKey(Schema.Unknown),
})

const keysPlugin: Plugin<Schema.Schema.Type<typeof keysConfig>, ConfigKeysService, never> = {
  name: '@test/keys',
  config: keysConfig,
  provides: [ConfigKeysService],
  requires: [],
  layer: () => serviceLayer,
}

const nonePlugin: Plugin<{}, ConfigKeysService, never> = {
  name: '@test/none',
  config: Schema.Struct({}),
  provides: [ConfigKeysService],
  requires: [],
  layer: () => serviceLayer,
}

describe('renderPluginKeys', () => {
  test('lists the declared keys with required, optional, and what each takes', () => {
    const text = renderPluginKeys([nonePlugin, keysPlugin])

    expect(text).toBe(
      [
        "config keys (from each plugin's schema; keys it does not declare are ignored):",
        '  - @test/keys: preset (required, one of read-only|full), baseUrl (required, string), roots (optional, string[]), anything (optional, any)',
        '  - @test/none: none',
        '',
      ].join('\n'),
    )
  })
})
