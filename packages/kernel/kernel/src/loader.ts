import { Effect, Layer, Schema } from 'effect'
import { PluginError } from './errors.ts'
import type { Plugin } from './plugin.ts'
import { mergeRows, type PluginRow } from './profile.ts'

export interface LoadProfileOptions {
  readonly plugins: ReadonlyArray<Plugin<any, any, any>>
  readonly layers: ReadonlyArray<ReadonlyArray<PluginRow>>
}

const dependentsOf = (
  rows: ReadonlyArray<PluginRow>,
  dependencies: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyMap<string, ReadonlyArray<PluginRow>> => {
  const dependents = new Map<string, PluginRow[]>()
  for (const row of rows) {
    for (const dependency of dependencies.get(row.id) ?? []) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), row])
    }
  }
  return dependents
}

/** Decrements the pending count of each dependent and returns the ones that became ready. */
const releaseDependents = (
  rowId: string,
  pending: Map<string, number>,
  dependents: ReadonlyMap<string, ReadonlyArray<PluginRow>>,
): ReadonlyArray<PluginRow> =>
  (dependents.get(rowId) ?? []).filter((dependent) => {
    const count = (pending.get(dependent.id) ?? 0) - 1
    pending.set(dependent.id, count)
    return count === 0
  })

const topologicalOrder = (
  rows: ReadonlyArray<PluginRow>,
  dependencies: ReadonlyMap<string, ReadonlyArray<string>>,
): Effect.Effect<ReadonlyArray<PluginRow>, PluginError> => {
  const pending = new Map(rows.map((row) => [row.id, dependencies.get(row.id)?.length ?? 0]))
  const dependents = dependentsOf(rows, dependencies)
  const ready = rows.filter((row) => pending.get(row.id) === 0)
  const ordered: PluginRow[] = []
  for (let index = 0; index < ready.length; index++) {
    const row = ready[index]!
    ordered.push(row)
    ready.push(...releaseDependents(row.id, pending, dependents))
  }
  if (ordered.length === rows.length) return Effect.succeed(ordered)
  const cycle = rows.filter((row) => !ordered.includes(row)).map((row) => row.id)
  return Effect.fail(
    new PluginError({
      code: 'dependency-cycle',
      message: `dependency cycle among ${cycle.join(', ')}`,
    }),
  )
}

/**
 * Merges the profile layers and builds one layer in dependency order.
 *
 * Fails before building anything when a row names an unknown plugin, two rows
 * provide the same service, a required service has no provider, the providers
 * form a cycle, or a config does not match its plugin schema. A failure while
 * the returned layer is built releases the already-built plugins in reverse.
 */
export function loadProfile(
  options: LoadProfileOptions,
): Effect.Effect<Layer.Layer<any, PluginError, never>, PluginError> {
  return Effect.gen(function* () {
    const pluginsByName = new Map<string, Plugin<any, any, any>>()
    for (const plugin of options.plugins) {
      if (pluginsByName.has(plugin.name)) {
        return yield* Effect.fail(
          new PluginError({
            code: 'duplicate-plugin',
            message: `plugin ${plugin.name} is registered twice`,
            pluginId: plugin.name,
          }),
        )
      }
      pluginsByName.set(plugin.name, plugin)
    }

    const rows = mergeRows(options.layers)
    const enabled = rows.filter((row) => row.disabled !== true)

    for (const row of enabled) {
      if (!pluginsByName.has(row.name)) {
        return yield* Effect.fail(
          new PluginError({
            code: 'unknown-plugin',
            message: `row ${row.id} names unknown plugin ${row.name}`,
            pluginId: row.id,
          }),
        )
      }
    }

    const providerByService = new Map<string, PluginRow>()
    for (const row of enabled) {
      const plugin = pluginsByName.get(row.name)!
      for (const service of plugin.provides) {
        const existing = providerByService.get(service.key)
        if (existing !== undefined && existing.id !== row.id) {
          return yield* Effect.fail(
            new PluginError({
              code: 'duplicate-provider',
              message: `service ${service.key} is provided by both ${existing.id} and ${row.id}`,
              pluginId: row.id,
              service: service.key,
            }),
          )
        }
        providerByService.set(service.key, row)
      }
    }

    const dependencies = new Map<string, ReadonlyArray<string>>()
    for (const row of enabled) {
      const plugin = pluginsByName.get(row.name)!
      const providers = new Set<string>()
      for (const service of plugin.requires) {
        const provider = providerByService.get(service.key)
        if (provider === undefined) {
          return yield* Effect.fail(
            new PluginError({
              code: 'missing-provider',
              message: `row ${row.id} requires ${service.key}, but no enabled plugin provides it`,
              pluginId: row.id,
              service: service.key,
            }),
          )
        }
        providers.add(provider.id)
      }
      dependencies.set(row.id, [...providers])
    }

    const ordered = yield* topologicalOrder(enabled, dependencies)

    const built = new Map<string, Layer.Layer<any, any, any>>()
    for (const row of ordered) {
      const plugin = pluginsByName.get(row.name)!
      const config = yield* Schema.decodeUnknownEffect(plugin.config)(row.config ?? {}).pipe(
        Effect.mapError(
          (issue) =>
            new PluginError({
              code: 'config',
              message: `config of ${row.id} is invalid: ${issue.message}`,
              pluginId: row.id,
            }),
        ),
      ) as Effect.Effect<any, PluginError, never>
      const layer = plugin.layer(config) as Layer.Layer<any, any, any>
      const deps = (dependencies.get(row.id) ?? []).map((id) => built.get(id)!)
      built.set(
        row.id,
        deps.length === 0 ? layer : Layer.provide(layer, Layer.mergeAll(...toNonEmpty(deps))),
      )
    }

    const layers = [...built.values()]
    const final = layers.length === 0 ? Layer.empty : Layer.mergeAll(...toNonEmpty(layers))
    return final as Layer.Layer<any, PluginError, never>
  })
}

const toNonEmpty = <A>(values: ReadonlyArray<A>): [A, ...Array<A>] => values as [A, ...Array<A>]
