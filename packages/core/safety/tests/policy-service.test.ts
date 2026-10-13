import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { Policy, policyLayer } from '../src/index.ts'

describe('Policy service', () => {
  test('carries the preset and judges against it', async () => {
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        const policy = yield* Policy
        return {
          preset: policy.preset,
          read: policy.decide(['read']),
          exec: policy.decide(['exec']),
        }
      }).pipe(Effect.provide(policyLayer('read-only'))),
    )

    expect(observed.preset).toBe('read-only')
    expect(observed.read).toEqual({ kind: 'allow' })
    expect(observed.exec).toEqual({
      kind: 'ask',
      reason: 'preset read-only does not allow: exec',
    })
  })
})
