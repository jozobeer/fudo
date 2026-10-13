import { describe, expect, test } from 'bun:test'
import type { Agent } from '@fudo/agent'
import { makeHooks } from '@fudo/kernel'
import type { Session, SessionEvent, SessionEventMap } from '@fudo/session'
import { Effect, Fiber, Stream, type Scope } from 'effect'
import { makeUiHost } from '../src/index.ts'
import type { UiHost } from '@fudo/ui-protocol'

interface FakeInput {
  readonly session: Session
  readonly agent: Agent
  readonly hooks: ReturnType<typeof makeHooks>
  readonly otherSession: Session
  readonly otherAgent: Agent
  readonly submitted: Array<string>
  readonly cancelled: Array<string>
  append<K extends keyof SessionEventMap>(type: K, data: SessionEventMap[K]): Effect.Effect<void>
}

const makeInput = (): FakeInput => {
  const hooks = makeHooks()
  const submitted: Array<string> = []
  const cancelled: Array<string> = []
  const events: Array<SessionEvent> = []
  const holder: { session?: Session } = {}
  const session = {
    id: 'session-main',
    header: { formatVersion: 1, createdAt: 0, cwd: '/work' },
    events: () => [...events],
    append: (type: string, data: unknown) =>
      Effect.gen(function* () {
        const event = {
          seq: events.length + 1,
          time: 1_700_000_000_000 + events.length,
          type,
          data,
        } as SessionEvent
        events.push(event)
        yield* hooks.emit('session/event', event, holder.session as Session)
      }),
    flush: () => Effect.void,
    derive: () => [],
  } as unknown as Session
  holder.session = session
  const otherEvents: Array<SessionEvent> = []
  const otherHolder: { session?: Session } = {}
  const otherSession = {
    id: 'session-child',
    header: { formatVersion: 1, createdAt: 0, cwd: '/work' },
    events: () => [...otherEvents],
    append: () => Effect.void,
    flush: () => Effect.void,
    derive: () => [],
  } as unknown as Session
  otherHolder.session = otherSession
  const agent = {
    session,
    followup: (message: { text: string }) =>
      Effect.sync(() => {
        submitted.push(message.text)
      }),
    cancel: (cause: string) =>
      Effect.sync(() => {
        cancelled.push(cause)
      }),
  } as unknown as Agent
  const otherAgent = { session: otherSession } as unknown as Agent
  return {
    session,
    agent,
    hooks,
    otherSession,
    otherAgent,
    submitted,
    cancelled,
    append: (type, data) => session.append(type, data) as Effect.Effect<void>,
  }
}

const withHost = <A, E>(
  input: FakeInput,
  run: (host: UiHost) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* makeUiHost({
          session: input.session,
          agent: input.agent,
          hooks: input.hooks,
        })
        return yield* run(host)
      }),
    ),
  )

describe('ui host', () => {
  test('a subscriber receives the log as history in order', async () => {
    const input = makeInput()
    await withHost(input, (host) =>
      Effect.gen(function* () {
        yield* input.append('user/message', { text: 'first', source: 'user' })
        yield* input.append('user/message', { text: 'second', source: 'user' })
        const collected = yield* host.events.pipe(Stream.take(2), Stream.runCollect)
        expect([...collected].map((event) => event.kind)).toEqual(['session', 'session'])
        expect(
          [...collected].flatMap((event) =>
            event.kind === 'session' && event.event.type === 'user/message'
              ? [(event.event.data as { text: string }).text]
              : [],
          ),
        ).toEqual(['first', 'second'])
      }),
    )
  })

  test('an approval waits for the command and the command answers it', async () => {
    const input = makeInput()
    await withHost(input, (host) =>
      Effect.gen(function* () {
        yield* input.append('safety/approval/requested', {
          callId: 'c1',
          tool: 'bash',
          reason: 'outside the preset',
        })
        const waiting = yield* Effect.forkScoped(
          host.answerApproval({ callId: 'c1', tool: 'bash', reason: 'outside the preset' }),
        )
        yield* host.approve('c1', true)
        expect(yield* Fiber.join(waiting)).toBe(true)
      }),
    )
  })

  test('a missing approval is denied instead of hanging', async () => {
    const input = makeInput()
    await withHost(input, (host) =>
      Effect.gen(function* () {
        expect(yield* host.answerApproval({ callId: 'gone', tool: 'bash', reason: '' })).toBe(false)
      }),
    )
  })

  test('a question waits for the answer command', async () => {
    const input = makeInput()
    await withHost(input, (host) =>
      Effect.gen(function* () {
        yield* input.append('interaction/ask/requested', {
          id: 'a1',
          question: 'which one?',
          options: [],
        })
        const waiting = yield* Effect.forkScoped(
          host.answerAsk({ id: 'a1', question: 'which one?', options: [] }),
        )
        yield* host.answer('a1', 'the second')
        expect(yield* Fiber.join(waiting)).toBe('the second')
      }),
    )
  })

  test('submit and cancel reach the agent', async () => {
    const input = makeInput()
    await withHost(input, (host) =>
      Effect.gen(function* () {
        yield* host.submit('do it')
        yield* host.cancel()
        expect(input.submitted).toEqual(['do it'])
        expect(input.cancelled).toEqual(['user'])
      }),
    )
  })

  test('events from another session or agent never reach the UI', async () => {
    const input = makeInput()
    await withHost(input, (host) =>
      Effect.gen(function* () {
        yield* input.hooks.emit(
          'session/event',
          {
            seq: 1,
            time: 0,
            type: 'user/message',
            data: { text: 'child work', source: 'user' },
          } as SessionEvent,
          input.otherSession,
        )
        yield* input.hooks.emit(
          'agent/assistant-stream',
          {
            time: 0,
            chunk: { type: 'text-delta', index: 0, text: 'child text' },
          },
          input.otherAgent,
        )
        yield* input.append('user/message', { text: 'main work', source: 'user' })
        const collected = yield* host.events.pipe(Stream.take(1), Stream.runCollect)
        expect([...collected]).toHaveLength(1)
        expect(
          [...collected].flatMap((event) =>
            event.kind === 'session' && event.event.type === 'user/message'
              ? [(event.event.data as { text: string }).text]
              : [],
          ),
        ).toEqual(['main work'])
      }),
    )
  })

  test('a live event reaches a subscriber that already read history', async () => {
    const input = makeInput()
    await withHost(input, (host) =>
      Effect.gen(function* () {
        yield* input.append('user/message', { text: 'before', source: 'user' })
        const first = yield* Effect.forkScoped(host.events.pipe(Stream.take(2), Stream.runCollect))
        yield* Effect.sleep(10)
        yield* input.append('user/message', { text: 'live', source: 'user' })
        yield* Effect.sleep(10)
        const collected = yield* Fiber.join(first)
        expect([...collected].map((event) => event.kind)).toEqual(['session', 'session'])
      }),
    )
  })
})
