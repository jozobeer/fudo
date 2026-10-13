import { describe, expect, test } from 'bun:test'
import { Context, Effect, Layer } from 'effect'
import { Sandbox, noneSandboxLayer } from '../src/index.ts'

describe('noneSandbox', () => {
  test('passes a command through unchanged', async () => {
    const wrapped = await Effect.runPromise(
      Effect.gen(function* () {
        const sandbox = yield* Sandbox
        return yield* sandbox.wrap({ argv: ['echo', 'hi'], cwd: '/work' })
      }).pipe(Effect.provide(noneSandboxLayer)),
    )

    expect(wrapped).toEqual({ argv: ['echo', 'hi'], cwd: '/work' })
  })

  test('resolves through a hand-built layer', async () => {
    const context = await Effect.runPromise(Effect.scoped(Layer.build(noneSandboxLayer)))

    expect(Context.get(context, Sandbox).name).toBe('none')
  })
})
