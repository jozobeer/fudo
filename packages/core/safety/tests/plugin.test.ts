import { kernelPlugin, loadProfile } from '@jozo-harness/kernel'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { Policy, Sandbox, safetyPlugin, sandboxLayerFor } from '../src/index.ts'

const build = (config: unknown) =>
  Effect.scoped(
    Effect.gen(function* () {
      const layer = yield* loadProfile({
        plugins: [kernelPlugin, systemPromptPlugin, safetyPlugin],
        layers: [
          [
            { id: 'kernel', name: '@jozo-harness/kernel', config: {} },
            { id: 'system-prompt', name: '@jozo-harness/system-prompt', config: {} },
            { id: 'safety', name: '@jozo-harness/safety', config },
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
  test('contains commands by default', async () => {
    const observed = await Effect.runPromise(build({ preset: 'read-only' }))

    expect(observed.preset).toBe('read-only')
    expect(observed.exec.kind).toBe('ask')
    // No sandbox key at all: the provider this platform has is what runs.
    expect(observed.sandbox).toBe('seatbelt')
  })

  test('running without a sandbox is an explicit choice', async () => {
    const observed = await Effect.runPromise(build({ preset: 'full', sandbox: 'none' }))

    expect(observed.sandbox).toBe('none')
  })

  test('asking for seatbelt where it cannot run fails instead of running loose', async () => {
    const failed = await Effect.runPromise(
      Effect.scoped(
        Effect.result(
          Layer.build(sandboxLayerFor({ preset: 'full', sandbox: 'seatbelt' }, 'linux')),
        ),
      ),
    )

    expect(failed._tag).toBe('Failure')
    if (failed._tag === 'Failure') {
      expect(String(failed.failure)).toContain('sandbox: none')
    }
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
