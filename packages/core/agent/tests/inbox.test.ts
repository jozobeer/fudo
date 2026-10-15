import { describe, expect, test } from 'bun:test'
import {
  SessionEventSchemas,
  decodeSessionEvent,
  extendSessionEventSchemas,
  makeSession,
  type Session,
  type SessionEvent,
  type SessionSink,
} from '@jozo-harness/session'
import { Effect } from 'effect'
import { inboxEventSchemas, makeInbox, projectInbox, type UserMessage } from '../src/index.ts'

const user = (text: string): UserMessage => ({ text, source: 'user' })

const makeTestSession = async (): Promise<{ session: Session; written: Array<SessionEvent> }> => {
  const written: Array<SessionEvent> = []
  const sink: SessionSink = {
    append: (event) =>
      Effect.sync(() => {
        written.push(event)
      }),
    flush: () => Effect.void,
  }
  const session = await Effect.runPromise(
    makeSession({
      id: 's-1',
      events: [
        {
          seq: 1,
          time: 1,
          type: 'session/header',
          data: { formatVersion: 1, createdAt: 1, cwd: '/work' },
        },
      ],
      sink,
      now: () => 100,
    }),
  )
  return { session, written }
}

describe('Inbox', () => {
  test('queues messages into both targets and reports pending work', async () => {
    const { session } = await makeTestSession()
    const inbox = makeInbox(session)
    const turn = user(crypto.randomUUID())
    const step = user(crypto.randomUUID())

    await Effect.runPromise(inbox.queue('next-turn', turn))
    await Effect.runPromise(inbox.queue('next-step', step))

    expect(inbox.nextTurn).toEqual([turn])
    expect(inbox.nextStep).toEqual([step])
    expect(inbox.pending).toBe(true)
  })

  test('claim without a turn drains the step queue only', async () => {
    const { session } = await makeTestSession()
    const inbox = makeInbox(session)
    const turn = user(crypto.randomUUID())
    const first = user(crypto.randomUUID())
    const second = user(crypto.randomUUID())

    await Effect.runPromise(inbox.queue('next-turn', turn))
    await Effect.runPromise(inbox.queue('next-step', first))
    await Effect.runPromise(inbox.queue('next-step', second))

    const claimed = await Effect.runPromise(inbox.claim(false))

    expect(claimed).toEqual([first, second])
    expect(inbox.nextStep).toEqual([])
    expect(inbox.nextTurn).toEqual([turn])
  })

  test('claim with a turn takes step messages first and then one turn message', async () => {
    const { session } = await makeTestSession()
    const inbox = makeInbox(session)
    const firstTurn = user(crypto.randomUUID())
    const secondTurn = user(crypto.randomUUID())
    const step = user(crypto.randomUUID())

    await Effect.runPromise(inbox.queue('next-turn', firstTurn))
    await Effect.runPromise(inbox.queue('next-turn', secondTurn))
    await Effect.runPromise(inbox.queue('next-step', step))

    expect(await Effect.runPromise(inbox.claim(true))).toEqual([step, firstTurn])
    expect(inbox.nextStep).toEqual([])
    expect(inbox.nextTurn).toEqual([secondTurn])
  })

  test('claimed input does not come back after restoring the log', async () => {
    const { session, written } = await makeTestSession()
    const inbox = makeInbox(session)
    const claimedMessage = user(crypto.randomUUID())
    const pendingMessage = user(crypto.randomUUID())

    await Effect.runPromise(inbox.queue('next-turn', claimedMessage))
    await Effect.runPromise(inbox.queue('next-step', pendingMessage))
    await Effect.runPromise(inbox.claim(true))
    await Effect.runPromise(inbox.queue('next-turn', pendingMessage))

    const restored = projectInbox([
      {
        seq: 1,
        time: 1,
        type: 'session/header',
        data: { formatVersion: 1, createdAt: 1, cwd: '/work' },
      },
      ...written,
    ])

    expect(restored.nextTurn).toEqual([pendingMessage])
    expect(restored.nextStep).toEqual([])
  })

  test('a duplicate text is claimed one occurrence at a time', async () => {
    const { session } = await makeTestSession()
    const inbox = makeInbox(session)
    const duplicated = user('same text')

    await Effect.runPromise(inbox.queue('next-step', duplicated))
    await Effect.runPromise(inbox.queue('next-step', { text: 'same text', source: 'user' }))

    await Effect.runPromise(inbox.claim(false))

    expect(inbox.nextStep).toHaveLength(0)
  })

  test('inbox events are appended to the session and decode with the agent schemas', async () => {
    const { session, written } = await makeTestSession()
    const inbox = makeInbox(session)
    const message = user(crypto.randomUUID())

    await Effect.runPromise(inbox.queue('next-turn', message))

    expect(written.map((event) => event.type)).toEqual(['agent/inbox/queued'])

    const schemas = extendSessionEventSchemas(SessionEventSchemas, inboxEventSchemas)
    expect(await Effect.runPromise(decodeSessionEvent(throughJson(written[0]), schemas))).toEqual(
      written[0],
    )
  })
})

const throughJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
