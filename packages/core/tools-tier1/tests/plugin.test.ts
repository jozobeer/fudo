import { kernelPlugin, loadProfile } from '@fudo/kernel'
import { askPlugin } from '@fudo/safety'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { Tier1Tools, tier1Plugin } from '../src/index.ts'

describe('tier1Plugin', () => {
  test('resolves the tool list through the ask row', async () => {
    const names = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const layer = yield* loadProfile({
            plugins: [kernelPlugin, askPlugin, tier1Plugin],
            layers: [
              [
                { id: 'kernel', name: '@fudo/kernel', config: {} },
                { id: 'ask', name: '@fudo/ask', config: {} },
                { id: 'tier1', name: '@fudo/tools-tier1', config: {} },
              ],
            ],
          })
          const context = yield* Layer.build(layer)
          return Context.get(context, Tier1Tools).map((tool) => tool.name)
        }),
      ),
    )

    expect(names).toEqual(['todo_write', 'ask_user', 'web_fetch', 'read_image'])
  })
})
