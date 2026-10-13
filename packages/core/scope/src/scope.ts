import { Data, Effect, type Scope } from 'effect'

export type RegistryErrorCode = 'duplicate-entry'

/** A registration failure inside one scoped registry. */
export class RegistryError extends Data.TaggedError('RegistryError')<{
  readonly code: RegistryErrorCode
  readonly message: string
}> {}

/**
 * A registry whose entries live as long as the scope that registered them.
 * A child sees its ancestors' entries and can override them by name.
 */
export interface ScopedRegistry<V> {
  register(name: string, value: V): Effect.Effect<void, RegistryError, Scope.Scope>
  get(name: string): V | undefined
  names(): ReadonlyArray<string>
  values(): ReadonlyArray<V>
  /** A child of this registry. It shares live state with its ancestors. */
  child(): ScopedRegistry<V>
}

interface RegistryNode<V> {
  readonly parent: RegistryNode<V> | undefined
  readonly entries: Map<string, V>
}

const merged = <V>(node: RegistryNode<V>): ReadonlyArray<readonly [string, V]> => {
  const chain: Array<RegistryNode<V>> = []
  for (
    let current: RegistryNode<V> | undefined = node;
    current !== undefined;
    current = current.parent
  ) {
    chain.push(current)
  }
  const result = new Map<string, V>()
  for (const level of chain.reverse()) {
    for (const [name, value] of level.entries) result.set(name, value)
  }
  return [...result]
}

const lookup = <V>(node: RegistryNode<V>, name: string): V | undefined => {
  for (
    let current: RegistryNode<V> | undefined = node;
    current !== undefined;
    current = current.parent
  ) {
    const value = current.entries.get(name)
    if (value !== undefined) return value
  }
  return undefined
}

const registryOf = <V>(node: RegistryNode<V>): ScopedRegistry<V> => ({
  register: (name, value) =>
    Effect.gen(function* () {
      if (node.entries.has(name)) {
        return yield* Effect.fail(
          new RegistryError({
            code: 'duplicate-entry',
            message: `${name} is already registered in this scope`,
          }),
        )
      }
      node.entries.set(name, value)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (node.entries.get(name) === value) node.entries.delete(name)
        }),
      )
    }),

  get: (name) => lookup(node, name),
  names: () => merged(node).map(([name]) => name),
  values: () => merged(node).map(([, value]) => value),
  child: () => registryOf({ parent: node, entries: new Map() }),
})

/** Creates a root registry. Children inherit its entries live. */
export function makeScopedRegistry<V>(): ScopedRegistry<V> {
  return registryOf({ parent: undefined, entries: new Map() })
}
