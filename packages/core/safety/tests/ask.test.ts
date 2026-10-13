import { decodeSessionEvent } from '@fudo/session'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@fudo/session'
import { Deferred, Effect } from 'effect'
import { describe, expect, test } from 'bun:test'
import { Ask, askEventSchemas, askServiceLayer, installAsk, makeAsk } from '../src/index.ts'

describe('ask', () => {
  test('an answer releases the waiting question', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ask = yield* Ask
          const seen = yield* Deferred.make<string>()
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              const answer = yield* ask.ask({ id: 'q1', question: 'which?', options: [] })
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

describe('installAsk', () => {
  test('records the question and the answer', async () => {
    const events: Array<SessionEvent> = []
    const session = {
      id: 's1' as SessionId,
      header: { formatVersion: 1, createdAt: 0, cwd: '/tmp' } as SessionHeader,
      events: () => [...events],
      append: (type: string, data: unknown) =>
        Effect.sync(() => {
          events.push({ seq: events.length + 1, time: 0, type, data } as SessionEvent)
        }),
      flush: () => Effect.void,
      derive: () => [],
    } as unknown as Session

    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ask = installAsk(yield* makeAsk(), session)
          const seen = yield* Deferred.make<string>()
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              const answer = yield* ask.ask({ id: 'q9', question: 'pick', options: ['a'] })
              yield* Deferred.succeed(seen, answer)
            }),
          )
          yield* Effect.sleep('5 millis')
          yield* ask.answer('q9', 'a')
          const answer = yield* Deferred.await(seen)
          return { answer, types: events.map((event) => event.type) }
        }),
      ),
    )

    expect(observed.answer).toBe('a')
    expect(observed.types).toEqual(['interaction/ask/requested', 'interaction/ask/answered'])
  })
})
