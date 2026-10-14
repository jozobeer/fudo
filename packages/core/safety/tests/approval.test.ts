import { describe, expect, test } from 'bun:test'
import { Deferred, Effect, Option } from 'effect'
import { makeApproval } from '../src/index.ts'

describe('makeApproval', () => {
  test('a request nobody listens for is refused at once', async () => {
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        const approval = yield* makeApproval()
        // The timeout only keeps a hanging seam from hanging the suite: a refusal
        // needs no clock at all, so nothing but a refusal reaches the assertion.
        return yield* approval.request('c1').pipe(Effect.timeoutOption('50 millis'))
      }),
    )

    expect(Option.getOrNull(observed)).toBe(false)
  })

  test('listening makes a request wait for an answer, and stopping refuses again', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const approval = yield* makeApproval()
          yield* approval.listen()
          const seen = yield* Deferred.make<boolean>()
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              yield* Deferred.succeed(seen, yield* approval.request('c2'))
            }),
          )
          yield* Effect.sleep('5 millis')
          const listening = approval.pending()
          yield* approval.answer('c2', true)
          const waited = yield* Deferred.await(seen)
          yield* approval.stopListening()
          const after = yield* approval.request('c3').pipe(Effect.timeoutOption('50 millis'))
          return { listening, waited, after: Option.getOrNull(after) }
        }),
      ),
    )

    expect(observed).toEqual({ listening: ['c2'], waited: true, after: false })
  })

  test('an answer releases the waiting request', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const approval = yield* makeApproval()
          // Waiting is opt-in: without a listener the seam refuses at once.
          yield* approval.listen()
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
          yield* approval.listen()
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
