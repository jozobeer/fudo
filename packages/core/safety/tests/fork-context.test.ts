import { Hooks, HooksLive } from '@fudo/kernel'
import { Deferred, Effect } from 'effect'
import { describe, expect, test } from 'bun:test'

describe('forked work', () => {
  test('sees the provided hooks', async () => {
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const hooks = yield* Hooks
          const done = yield* Deferred.make<boolean>()
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              const inner = yield* Hooks
              yield* Deferred.succeed(done, inner === hooks)
            }),
          )
          return yield* Deferred.await(done)
        }).pipe(Effect.provide(HooksLive)),
      ),
    )

    expect(seen).toBe(true)
  })
})
