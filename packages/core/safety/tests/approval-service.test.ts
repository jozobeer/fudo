import { describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import { Approval, approvalServiceLayer } from '../src/index.ts'

describe('Approval service', () => {
  test('resolves from the layer and answers a request through the served answerer', async () => {
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        const approval = yield* Approval
        yield* approval.serve(() => Effect.succeed(true))
        return yield* approval.request({ callId: 'c9', tool: 'bash', reason: 'escalate' })
      }).pipe(Effect.provide(approvalServiceLayer)),
    )

    expect(observed).toBe(true)
  })
})
