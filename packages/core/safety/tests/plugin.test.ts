import { kernelPlugin, loadProfile } from '@fudo/kernel'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { Policy, Sandbox, safetyPlugin } from '../src/index.ts'

const build = (config: unknown) =>
  Effect.scoped(
    Effect.gen(function* () {
      const layer = yield* loadProfile({
        plugins: [kernelPlugin, systemPromptPlugin, safetyPlugin],
        layers: [
          [
            { id: 'kernel', name: '@fudo/kernel', config: {} },
            { id: 'system-prompt', name: '@fudo/system-prompt', config: {} },
            { id: 'safety', name: '@fudo/safety', config },
          ],
        ],
      })
      const context = yield* Layer.build(layer)
      const policy = Context.get(context, Policy)
      return {
        preset: policy.preset,
        exec: policy.decide(['exec']),
        sandbox: Context.get(context, Sandbox).name,
      }
    }),
  )

describe('safetyPlugin', () => {
  test('provides the preset and the pass-through sandbox by default', async () => {
    const observed = await Effect.runPromise(build({ preset: 'read-only' }))

    expect(observed.preset).toBe('read-only')
    expect(observed.exec.kind).toBe('ask')
    expect(observed.sandbox).toBe('none')
  })

  test('selects the seatbelt provider when asked', async () => {
    const observed = await Effect.runPromise(
      build({ preset: 'workspace-write', sandbox: 'seatbelt', writableRoots: ['/work'] }),
    )

    expect(observed.preset).toBe('workspace-write')
    expect(observed.exec.kind).toBe('ask')
    expect(observed.sandbox).toBe('seatbelt')
  })
})
