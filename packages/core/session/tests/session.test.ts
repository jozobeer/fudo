import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { SessionError, makeSession, type SessionEvent, type SessionSink } from '../src/index.ts'
import { event, headerEvent } from './support.ts'

interface Collected {
  readonly written: Array<SessionEvent>
  readonly notified: Array<SessionEvent>
  readonly flushes: Array<number>
  readonly sink: SessionSink
}

const collect = (): Collected => {
  const written: Array<SessionEvent> = []
  const notified: Array<SessionEvent> = []
  const flushes: Array<number> = []
  return {
    written,
    notified,
    flushes,
    sink: {
      append: (sessionEvent) =>
        Effect.sync(() => {
          written.push(sessionEvent)
        }),
      flush: () =>
        Effect.sync(() => {
          flushes.push(1)
        }),
    },
  }
}

describe('makeSession', () => {
  test('appends with the next seq and the injected time, then notifies observers', async () => {
    const collected = collect()
    const value = crypto.randomUUID()
    const session = await Effect.runPromise(
      makeSession({
        id: 's-1',
        events: [headerEvent()],
        sink: collected.sink,
        now: () => 111,
        notify: (sessionEvent) =>
          Effect.sync(() => {
            collected.notified.push(sessionEvent)
          }),
      }),
    )

    await Effect.runPromise(session.append('user/message', { text: value, source: 'user' }))

    expect(collected.written).toHaveLength(1)
    expect(collected.written[0]?.seq).toBe(2)
    expect(collected.written[0]?.time).toBe(111)
    expect(collected.written[0]?.type).toBe('user/message')
    expect(collected.notified).toEqual(collected.written)
    expect(session.events().map((sessionEvent) => sessionEvent.type)).toEqual([
      'session/header',
      'user/message',
    ])
    expect(session.header.cwd).toBe('/work')
  })

  test('continues the seq of a resumed log', async () => {
    const collected = collect()
    const session = await Effect.runPromise(
      makeSession({
        id: 's-2',
        events: [headerEvent(), event(2, 'user/message', { text: 'earlier', source: 'user' })],
        sink: collected.sink,
        now: () => 222,
      }),
    )

    await Effect.runPromise(session.append('system/message', { text: 'resume' }))

    expect(collected.written[0]?.seq).toBe(3)
  })

  test('rejects non-JSON data without writing or notifying', async () => {
    const collected = collect()
    const session = await Effect.runPromise(
      makeSession({ id: 's-3', events: [headerEvent()], sink: collected.sink, now: () => 1 }),
    )

    const error = await Effect.runPromise(
      Effect.flip(
        session.append('user/message', { text: Number.NaN as unknown as string, source: 'user' }),
      ),
    )

    expect(error).toBeInstanceOf(SessionError)
    expect(error.code).toBe('not-serializable')
    expect(collected.written).toEqual([])
  })

  test('an observer failure does not fail the append', async () => {
    const collected = collect()
    const session = await Effect.runPromise(
      makeSession({
        id: 's-4',
        events: [headerEvent()],
        sink: collected.sink,
        now: () => 1,
        notify: () => Effect.fail(new Error('observer exploded')),
      }),
    )

    await Effect.runPromise(
      session.append('user/message', { text: 'still stored', source: 'user' }),
    )

    expect(collected.written).toHaveLength(1)
  })

  test('flush delegates to the sink', async () => {
    const collected = collect()
    const session = await Effect.runPromise(
      makeSession({ id: 's-5', events: [headerEvent()], sink: collected.sink, now: () => 1 }),
    )

    await Effect.runPromise(session.flush())

    expect(collected.flushes).toHaveLength(1)
  })

  test('refuses a log that does not start with session/header', async () => {
    const collected = collect()
    const error = await Effect.runPromise(
      Effect.flip(makeSession({ id: 's-6', events: [], sink: collected.sink })),
    )

    expect(error.code).toBe('persistence')
  })
})
