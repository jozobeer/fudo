import { describe, expect, test } from 'bun:test'
import { Hooks, loadProfile, makeHooks, type Plugin } from '@jozo-harness/kernel'
import { Context, Effect, Layer, Schema } from 'effect'
import { Tools, toolsPlugin } from '../src/index.ts'

const kernelPlugin: Plugin<{}, Hooks, never> = {
  name: '@jozo-harness/kernel',
  config: Schema.Struct({}),
  provides: [Hooks],
  requires: [],
  layer: () => Layer.succeed(Hooks, makeHooks()),
}

const rows = [
  { id: 'kernel', name: '@jozo-harness/kernel', config: {} },
  { id: 'tools', name: '@jozo-harness/tools', config: {} },
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
