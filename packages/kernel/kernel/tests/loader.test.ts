import { describe, expect, test } from 'bun:test'
import { Context, Effect, Layer, Schema } from 'effect'
import {
  PluginError,
  loadProfile,
  mergeRows,
  parseProfile,
  renderConfig,
  type Plugin,
  type PluginRow,
} from '../src/index.ts'

class Alpha extends Context.Service<Alpha, { readonly id: string }>()('test/Alpha') {}
class Beta extends Context.Service<Beta, { readonly id: string; readonly alpha: string }>()(
  'test/Beta',
) {}

const alphaPlugin: Plugin<{ readonly label: string }, Alpha, never> = {
  name: 'alpha',
  config: Schema.Struct({ label: Schema.String }),
  provides: [Alpha],
  requires: [],
  layer: (config) => Layer.succeed(Alpha, { id: config.label }),
}

const alphaAlsoPlugin: Plugin<{}, Alpha, never> = {
  name: 'alpha-also',
  config: Schema.Struct({}),
  provides: [Alpha],
  requires: [],
  layer: () => Layer.succeed(Alpha, { id: 'alpha-also' }),
}

const betaPlugin: Plugin<{}, Beta, Alpha> = {
  name: 'beta',
  config: Schema.Struct({}),
  provides: [Beta],
  requires: [Alpha],
  layer: () =>
    Layer.effect(
      Beta,
      Effect.gen(function* () {
        const alpha = yield* Alpha
        return { id: 'beta', alpha: alpha.id }
      }),
    ),
}

const alphaRequiresBetaPlugin: Plugin<{}, Alpha, Beta> = {
  name: 'alpha-requires-beta',
  config: Schema.Struct({}),
  provides: [Alpha],
  requires: [Beta],
  layer: () =>
    Layer.effect(
      Alpha,
      Effect.gen(function* () {
        const beta = yield* Beta
        return { id: beta.id }
      }),
    ),
}

const betaRequiresAlphaPlugin: Plugin<{}, Beta, Alpha> = {
  name: 'beta-requires-alpha',
  config: Schema.Struct({}),
  provides: [Beta],
  requires: [Alpha],
  layer: () =>
    Layer.effect(
      Beta,
      Effect.gen(function* () {
        const alpha = yield* Alpha
        return { id: 'beta', alpha: alpha.id }
      }),
    ),
}

const row = (id: string, name: string, config?: unknown, disabled?: boolean): PluginRow => ({
  id,
  name,
  ...(config === undefined ? {} : { config }),
  ...(disabled === undefined ? {} : { disabled }),
})

const loadError = (
  plugins: ReadonlyArray<Plugin<any, any, any>>,
  layers: ReadonlyArray<ReadonlyArray<PluginRow>>,
) => Effect.runPromise(Effect.flip(loadProfile({ plugins, layers })))

describe('mergeRows', () => {
  test('overlays rows by id and appends new rows in first-seen order', () => {
    const merged = mergeRows([
      [row('alpha', 'alpha', { label: 'base' }), row('beta', 'beta', {})],
      [row('alpha', 'alpha', { extra: true }), row('gamma', 'gamma', {}, true)],
    ])

    expect(merged.map((r) => r.id)).toEqual(['alpha', 'beta', 'gamma'])
    expect(merged[0]?.config).toEqual({ label: 'base', extra: true })
    expect(merged[2]?.disabled).toBe(true)
  })

  test('a later layer can disable a row', () => {
    const merged = mergeRows([[row('alpha', 'alpha')], [row('alpha', 'alpha', undefined, true)]])
    expect(merged[0]?.disabled).toBe(true)
  })
})

describe('loadProfile', () => {
  test('builds a layer whose services resolve through their dependencies', async () => {
    const label = crypto.randomUUID()

    const beta = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const layer = yield* loadProfile({
            plugins: [alphaPlugin, betaPlugin],
            layers: [[row('alpha', 'alpha', { label }), row('beta', 'beta')]],
          })
          const context = yield* Layer.build(layer)
          return Context.get(context, Beta)
        }),
      ),
    )

    expect(beta).toEqual({ id: 'beta', alpha: label })
  })

  test('fails with missing-provider when a required service has no provider', async () => {
    const error = await loadError([betaPlugin], [[row('beta', 'beta')]])
    expect(error).toBeInstanceOf(PluginError)
    expect(error.code).toBe('missing-provider')
    expect(error.message).toContain('test/Alpha')
  })

  test('fails with dependency-cycle when providers require each other', async () => {
    const error = await loadError(
      [alphaRequiresBetaPlugin, betaRequiresAlphaPlugin],
      [[row('alpha', 'alpha-requires-beta'), row('beta', 'beta-requires-alpha')]],
    )
    expect(error.code).toBe('dependency-cycle')
  })

  test('fails with unknown-plugin when a row names an unregistered plugin', async () => {
    const error = await loadError([alphaPlugin], [[row('ghost', 'ghost')]])
    expect(error.code).toBe('unknown-plugin')
  })

  test('fails with config when the row config does not match the plugin schema', async () => {
    const error = await loadError([alphaPlugin], [[row('alpha', 'alpha', { label: 42 })]])
    expect(error.code).toBe('config')
    expect(error.pluginId).toBe('alpha')
  })

  test('skips disabled rows', async () => {
    const error = await loadError(
      [alphaPlugin, betaPlugin],
      [[row('alpha', 'alpha', undefined, true), row('beta', 'beta')]],
    )
    expect(error.code).toBe('missing-provider')
  })

  test('fails with duplicate-provider when two rows provide the same service', async () => {
    const error = await loadError(
      [alphaPlugin, alphaAlsoPlugin],
      [[row('alpha', 'alpha'), row('alpha-2', 'alpha-also')]],
    )
    expect(error.code).toBe('duplicate-provider')
  })
})

describe('renderConfig', () => {
  test('renders the effective rows and their config', () => {
    const text = renderConfig([
      row('alpha', 'alpha', { label: 'x' }),
      row('beta', 'beta', {}),
      row('gamma', 'gamma', undefined, true),
    ])
    expect(text).toBe(
      'plugins:\n  - id=alpha name=alpha config={"label":"x"}\n  - id=beta name=beta config={}\n  - id=gamma name=gamma disabled\n',
    )
  })
})

describe('parseProfile', () => {
  test('parses a YAML profile into rows', async () => {
    const label = crypto.randomUUID()
    const text = [
      'name: test',
      'plugins:',
      '  - id: alpha',
      '    name: alpha',
      '    config:',
      `      label: ${label}`,
    ].join('\n')

    const profile = await Effect.runPromise(parseProfile(text))

    expect(profile.name).toBe('test')
    expect(profile.plugins).toEqual([{ id: 'alpha', name: 'alpha', config: { label } }])
  })

  test('fails with config when the YAML is malformed', async () => {
    const error = await Effect.runPromise(Effect.flip(parseProfile('name: [unclosed')))
    expect(error.code).toBe('config')
  })

  test('fails with config when the profile shape is wrong', async () => {
    const error = await Effect.runPromise(Effect.flip(parseProfile('name: test\nplugins: nope')))
    expect(error.code).toBe('config')
  })
})
