import { describe, expect, test } from 'bun:test'
import { Deferred, Effect } from 'effect'
import { Approval, approvalServiceLayer } from '../src/index.ts'

describe('Approval service', () => {
  test('resolves from the layer and releases a request', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const approval = yield* Approval
          // Waiting is opt-in: the seam refuses at once while nobody listens.
          yield* approval.listen()
          const seen = yield* Deferred.make<boolean>()
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              const value = yield* approval.request('c9')
              yield* Deferred.succeed(seen, value)
            }),
          )
          yield* Effect.sleep('5 millis')
          const answered = yield* approval.answer('c9', true)
          const result = yield* Deferred.await(seen)
          return { answered, result }
        }).pipe(Effect.provide(approvalServiceLayer)),
      ),
    )

    expect(observed).toEqual({ answered: true, result: true })
  })
})
