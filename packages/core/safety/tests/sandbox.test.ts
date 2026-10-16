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

    expect(wrapped).toEqual({
      argv: ['echo', 'hi'],
      cwd: '/work',
      mode: 'danger-full-access',
      denialSignatures: [],
    })
  })

  test('a provider that confines nothing names no denial dialect', async () => {
    const wrapped = await Effect.runPromise(
      Effect.gen(function* () {
        const sandbox = yield* Sandbox
        return yield* sandbox.wrap({ argv: ['echo', 'hi'], cwd: '/work' })
      }).pipe(Effect.provide(noneSandboxLayer)),
    )

    expect(wrapped.denialSignatures).toEqual([])
  })

  test('resolves through a hand-built layer', async () => {
    const context = await Effect.runPromise(Effect.scoped(Layer.build(noneSandboxLayer)))

    expect(Context.get(context, Sandbox).name).toBe('none')
  })

  test('nothing is confined, so the standing mode is full access', async () => {
    const context = await Effect.runPromise(Effect.scoped(Layer.build(noneSandboxLayer)))
    const sandbox = Context.get(context, Sandbox)

    expect(sandbox.confines).toBe(false)
    expect(sandbox.mode).toBe('danger-full-access')
  })
})
