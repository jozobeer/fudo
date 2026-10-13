import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { RegistryError, makeScopedRegistry } from '../src/index.ts'

const value = (): string => crypto.randomUUID()

describe('ScopedRegistry', () => {
  test('removes entries when their scope closes', async () => {
    const registry = makeScopedRegistry<string>()
    const first = value()
    const second = value()

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* registry.register('first', first)
          yield* registry.register('second', second)
          yield* Effect.yieldNow
        }),
      ),
    )

    // Registrations without a surrounding scope still resolve? No: the scope closed, so they are gone.
    expect(registry.get('first')).toBeUndefined()
  })

  test('keeps entries while their scope is open', async () => {
    const registry = makeScopedRegistry<string>()
    const first = value()
    const second = value()

    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* registry.register('first', first)
          yield* registry.register('second', second)
          return {
            names: registry.names(),
            values: registry.values(),
            first: registry.get('first'),
          }
        }),
      ),
    )

    expect(seen.names).toEqual(['first', 'second'])
    expect(seen.values).toEqual([first, second])
    expect(seen.first).toBe(first)
  })

  test('a child sees parent entries and overrides them without touching the parent', async () => {
    const root = makeScopedRegistry<string>()
    const rootValue = value()
    const childValue = value()

    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* root.register('tool', rootValue)
          const child = root.child()
          yield* child.register('tool', childValue)
          yield* child.register('extra', childValue)
          return { root: root.get('tool'), child: child.get('tool'), names: child.names() }
        }),
      ),
    )

    expect(seen.root).toBe(rootValue)
    expect(seen.child).toBe(childValue)
    expect(seen.names).toEqual(['tool', 'extra'])
  })

  test('inheritance is live: a parent registration after child creation is visible', async () => {
    const root = makeScopedRegistry<string>()
    const child = root.child()
    const late = value()

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* root.register('late', late)
          yield* Effect.yieldNow
        }),
      ),
    )
    expect(child.get('late')).toBeUndefined()

    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* root.register('late', late)
          return child.get('late')
        }),
      ),
    )
    expect(seen).toBe(late)
  })

  test('closing the child scope reveals the overridden parent entry', async () => {
    const root = makeScopedRegistry<string>()
    const rootValue = value()
    const childValue = value()
    const child = root.child()

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* root.register('tool', rootValue)
          const inner = yield* Effect.scoped(
            Effect.gen(function* () {
              yield* child.register('tool', childValue)
              return child.get('tool')
            }),
          )
          expect(inner).toBe(childValue)
          expect(child.get('tool')).toBe(rootValue)
        }),
      ),
    )
  })

  test('a duplicate name inside one scope fails with duplicate-entry', async () => {
    const registry = makeScopedRegistry<string>()
    const error = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* registry.register('same', value())
          return yield* Effect.flip(registry.register('same', value()))
        }),
      ),
    )

    expect(error).toBeInstanceOf(RegistryError)
    expect(error.code).toBe('duplicate-entry')
  })

  test('a grandchild sees both levels', async () => {
    const root = makeScopedRegistry<string>()
    const child = root.child()
    const grandchild = child.child()
    const rootValue = value()
    const childValue = value()

    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* root.register('root', rootValue)
          yield* child.register('child', childValue)
          return grandchild.values()
        }),
      ),
    )

    expect(seen).toEqual([rootValue, childValue])
  })
})
