import { kernelPlugin, loadProfile } from '@fudo/kernel'
import { safetyPlugin } from '@fudo/safety'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { Tier0Tools, tier0Plugin } from '../src/index.ts'

describe('tier0Plugin', () => {
  test('resolves the tool list with the sandbox from the safety row', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const layer = yield* loadProfile({
            plugins: [kernelPlugin, systemPromptPlugin, safetyPlugin, tier0Plugin],
            layers: [
              [
                { id: 'kernel', name: '@fudo/kernel', config: {} },
                { id: 'system-prompt', name: '@fudo/system-prompt', config: {} },
                {
                  id: 'safety',
                  name: '@fudo/safety',
                  config: {
                    preset: 'workspace-write',
                    sandbox: 'seatbelt',
                    writableRoots: ['/work'],
                  },
                },
                { id: 'tier0', name: '@fudo/tools-tier0', config: {} },
              ],
            ],
          })
          const context = yield* Layer.build(layer)
          const tools = Context.get(context, Tier0Tools)
          const bash = tools.find((tool) => tool.name === 'bash')
          return {
            names: tools.map((tool) => tool.name),
            bash: bash?.needs ?? [],
          }
        }),
      ),
    )

    expect(observed.names).toEqual(['read', 'write', 'edit', 'glob', 'grep', 'bash'])
    expect(observed.bash).toEqual(['exec'])
  })
})
