import { describe, expect, test } from 'bun:test'
import { Deferred, Effect } from 'effect'
import { makeApproval } from '../src/index.ts'

describe('makeApproval', () => {
  test('an answer releases the waiting request', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const approval = yield* makeApproval()
          const seen = yield* Deferred.make<boolean>()
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              const value = yield* approval.request('c1')
              yield* Deferred.succeed(seen, value)
            }),
          )
          yield* Effect.sleep('5 millis')
          const listed = approval.pending()
          const answered = yield* approval.answer('c1', true)
          const result = yield* Deferred.await(seen)
          return { listed, answered, result, left: approval.pending() }
        }),
      ),
    )

    expect(observed).toEqual({ listed: ['c1'], answered: true, result: true, left: [] })
  })

  test('a denial is delivered as false', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const approval = yield* makeApproval()
          const seen = yield* Deferred.make<boolean>()
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              const value = yield* approval.request('c2')
              yield* Deferred.succeed(seen, value)
            }),
          )
          yield* Effect.sleep('5 millis')
          yield* approval.answer('c2', false)
          return yield* Deferred.await(seen)
        }),
      ),
    )

    expect(result).toBe(false)
  })

  test('answering nothing reports false', async () => {
    const answered = await Effect.runPromise(
      Effect.gen(function* () {
        const approval = yield* makeApproval()
        return yield* approval.answer('missing', false)
      }),
    )

    expect(answered).toBe(false)
  })
})
