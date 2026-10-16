import { describe, expect, test } from 'bun:test'
import type { UiHost } from '@jozo-harness/ui-protocol'
import { Effect, Stream } from 'effect'
import { WebError } from '../src/server/errors.ts'
import {
  makeSessionRegistry,
  type OpenSession,
  type SessionFactory,
} from '../src/server/sessions.ts'
import type { RunStateView, SessionSummary } from '../src/shared/rpc.ts'

const summaryOf = (id: string): SessionSummary => ({ id, cwd: '/work', createdAt: 1, title: '' })

/** A host that does nothing; these tests are about who is asked and when. */
const hostOf = (): UiHost => ({
  events: Stream.empty,
  submit: () => Effect.succeed(undefined),
  approve: () => Effect.succeed(undefined),
  answer: () => Effect.succeed(undefined),
  cancel: () => Effect.succeed(undefined),
  answerApproval: () => Effect.succeed(true),
  answerAsk: () => Effect.succeed(''),
})

interface Fake {
  readonly factory: SessionFactory
  readonly asked: Array<string | undefined>
  readonly closed: Array<string>
}

const makeFactory = (): Fake => {
  const asked: Array<string | undefined> = []
  const closed: Array<string> = []
  return {
    asked,
    closed,
    factory: {
      list: () => Effect.succeed([summaryOf('a'), summaryOf('b')]),
      open: (id) =>
        Effect.gen(function* () {
          asked.push(id)
          const made = id ?? 'new-' + String(asked.length)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed.push(made)
            }),
          )
          return { summary: summaryOf(made), host: hostOf(), runState: runStateOf }
        }),
    },
  }
}

const runStateOf = (): RunStateView => ({ goal: null, schedules: [], jobs: [] })

const initial = (id: string): OpenSession => ({
  summary: summaryOf(id),
  host: hostOf(),
  runState: runStateOf,
})

describe('the session registry', () => {
  test('the session the server started with is served without opening another', async () => {
    const fake = makeFactory()
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeSessionRegistry({
            initial: initial('boot'),
            factory: fake.factory,
          })
          const listed = yield* registry.list()
          const opened = yield* registry.open('boot')
          return {
            initial: registry.initial,
            listed: listed.map((item) => item.id),
            opened: opened.summary.id,
            asked: fake.asked.length,
            known: registry.hostOf('boot') !== undefined,
          }
        }),
      ),
    )
    expect(seen).toEqual({
      initial: 'boot',
      listed: ['a', 'b'],
      opened: 'boot',
      asked: 0,
      known: true,
    })
  })

  test('a session asked for twice is opened once', async () => {
    const fake = makeFactory()
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeSessionRegistry({
            initial: initial('boot'),
            factory: fake.factory,
          })
          const first = yield* registry.open('a')
          const second = yield* registry.open('a')
          return { asked: fake.asked, same: first.host === second.host }
        }),
      ),
    )
    expect(seen.asked).toEqual(['a'])
    expect(seen.same).toBe(true)
  })

  test('creating without an id opens a new session and serves it under its own id', async () => {
    const fake = makeFactory()
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeSessionRegistry({
            initial: initial('boot'),
            factory: fake.factory,
          })
          const made = yield* registry.open(undefined)
          return { id: made.summary.id, known: registry.hostOf(made.summary.id) !== undefined }
        }),
      ),
    )
    expect(fake.asked).toEqual([undefined])
    expect(seen).toEqual({ id: 'new-1', known: true })
  })

  test('a factory that cannot open the session says why and remembers nothing', async () => {
    const failing: SessionFactory = {
      list: () => Effect.succeed([]),
      open: () => Effect.fail(new WebError({ message: 'it is gone' })),
    }
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeSessionRegistry({
            initial: initial('boot'),
            factory: failing,
          })
          const outcome = yield* registry
            .open('gone')
            .pipe(Effect.catch((error) => Effect.succeed(error.message)))
          return { outcome, known: registry.hostOf('gone') !== undefined }
        }),
      ),
    )
    expect(seen.known).toBe(false)
    expect(seen.outcome).toBe('it is gone')
  })

  test('closing the registry releases the sessions it opened', async () => {
    const fake = makeFactory()
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* makeSessionRegistry({
            initial: initial('boot'),
            factory: fake.factory,
          })
          yield* registry.open('a')
        }),
      ),
    )
    expect(fake.closed).toEqual(['a'])
  })
})
