import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { Policy, policyLayer } from '../src/index.ts'

describe('Policy service', () => {
  test('carries the preset and the mode it maps to', async () => {
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        const policy = yield* Policy
        return { preset: policy.preset, mode: policy.mode }
      }).pipe(Effect.provide(policyLayer('workspace-write'))),
    )

    expect(observed).toEqual({ preset: 'workspace-write', mode: 'workspace-write' })
  })

  test('the full preset runs commands unconfined', async () => {
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        const policy = yield* Policy
        return policy.mode
      }).pipe(Effect.provide(policyLayer('full'))),
    )

    expect(observed).toBe('danger-full-access')
  })
})
