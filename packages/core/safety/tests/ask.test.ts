import { decodeSessionEvent } from '@fudo/session'
import { Deferred, Effect } from 'effect'
import { describe, expect, test } from 'bun:test'
import { Ask, askServiceLayer, askEventSchemas } from '../src/index.ts'

describe('ask', () => {
  test('an answer releases the waiting question', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ask = yield* Ask
          const seen = yield* Deferred.make<string>()
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              const answer = yield* ask.ask('q1')
              yield* Deferred.succeed(seen, answer)
            }),
          )
          yield* Effect.sleep('5 millis')
          const pending = ask.pending()
          const answered = yield* ask.answer('q1', 'blue')
          const answer = yield* Deferred.await(seen)
          return { pending, answered, answer, left: ask.pending() }
        }).pipe(Effect.provide(askServiceLayer)),
      ),
    )

    expect(observed).toEqual({ pending: ['q1'], answered: true, answer: 'blue', left: [] })
  })

  test('answering nothing reports false', async () => {
    const answered = await Effect.runPromise(
      Effect.gen(function* () {
        const ask = yield* Ask
        return yield* ask.answer('missing', 'x')
      }).pipe(Effect.provide(askServiceLayer)),
    )

    expect(answered).toBe(false)
  })

  test('both events decode from the log', async () => {
    expect([...askEventSchemas.keys()]).toEqual([
      'interaction/ask/requested',
      'interaction/ask/answered',
    ])
    const event = await Effect.runPromise(
      decodeSessionEvent({
        seq: 2,
        time: 1,
        type: 'interaction/ask/requested',
        data: { id: 'q1', question: 'which colour?', options: ['blue', 'red'] },
      }),
    )

    expect(event?.type).toBe('interaction/ask/requested')
  })
})
