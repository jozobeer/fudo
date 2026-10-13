import { describe, expect, test } from 'bun:test'
import { Hooks, loadProfile, makeHooks, type Plugin } from '@fudo/kernel'
import { Context, Effect, Layer, Schema } from 'effect'
import { Tools, toolsPlugin } from '../src/index.ts'

const kernelPlugin: Plugin<{}, Hooks, never> = {
  name: '@fudo/kernel',
  config: Schema.Struct({}),
  provides: [Hooks],
  requires: [],
  layer: () => Layer.succeed(Hooks, makeHooks()),
}

const rows = [
  { id: 'kernel', name: '@fudo/kernel', config: {} },
  { id: 'tools', name: '@fudo/tools', config: {} },
]

describe('toolsPlugin', () => {
  test('assembles through the kernel loader and provides a usable registry', async () => {
    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const layer = yield* loadProfile({ plugins: [kernelPlugin, toolsPlugin], layers: [rows] })
        const context = yield* Layer.build(layer)
        const tools = Context.get(context, Tools)
        return tools.schemas()
      }).pipe(Effect.scoped),
    )

    expect(value).toEqual([])
  })
})
