import type { Agent } from '@fudo/agent'
import { Hooks, HooksLive } from '@fudo/kernel'
import type { SessionEvent } from '@fudo/session'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import {
  fireSchedule,
  installScheduleRuns,
  nextFire,
  pendingFires,
  type Schedule,
} from '../src/index.ts'

const NOW = 1_000_000

const event = (seq: number, type: string, data: unknown): SessionEvent =>
  ({ seq, time: seq, type, data }) as unknown as SessionEvent

const schedule = (
  id: string,
  seconds: number,
  createdAt = NOW,
  prompt = 'do the thing',
): Schedule => ({
  id,
  rule: { kind: 'every', seconds },
  prompt,
  createdAt,
})

const created = (seq: number, each: Schedule): SessionEvent =>
  event(seq, 'schedule/created', { schedule: each })

const fired = (seq: number, id: string, at: number): SessionEvent =>
  event(seq, 'schedule/fired', { id, at })

/** An agent that writes down what the driver asked of it. */
const fakeAgent = (events: Array<SessionEvent>) => {
  const sent: Array<{ text: string; source: string }> = []
  const agent = {
    session: {
      events: () => events,
      append: (type: string, data: unknown) =>
        Effect.sync(() => {
          events.push(event(events.length + 1, type, data))
        }),
    },
    followup: (message: { text: string; source: string }) =>
      Effect.sync(() => {
        sent.push(message)
      }),
  } as unknown as Agent
  return { agent, sent }
}

describe('when a schedule is due', () => {
  test('the soonest one comes first, and a deleted one never does', () => {
    const events = [
      created(1, schedule('slow', 600, NOW)),
      created(2, schedule('quick', 10, NOW)),
      event(3, 'schedule/deleted', { id: 'quick' }),
      created(4, schedule('middle', 30, NOW)),
    ]

    expect(pendingFires(events).map((pending) => pending.schedule.id)).toEqual(['middle', 'slow'])
    expect(nextFire(events)?.at).toBe(NOW + 30_000)
    expect(nextFire([])).toBeUndefined()
  })

  test('an interval counts from the last firing', () => {
    const events = [
      created(1, schedule('every-minute', 60, NOW)),
      fired(2, 'every-minute', NOW + 5_000),
    ]

    expect(nextFire(events)?.at).toBe(NOW + 65_000)
  })

  test('firing records the moment and hands the model the instruction', async () => {
    const { agent, sent } = fakeAgent([created(1, schedule('sched-1', 60))])

    await Effect.runPromise(fireSchedule(agent, schedule('sched-1', 60), () => NOW))

    expect(sent).toHaveLength(1)
    expect(sent[0]?.source).toBe('schedule')
    expect(sent[0]?.text).toContain('<schedule id="sched-1" rule="every 60s">')
    expect(sent[0]?.text).toContain('do the thing')
  })

  test('the clock fires a schedule whose time has come', async () => {
    const { agent, sent } = fakeAgent([
      // Created five seconds ago, repeating every second: overdue on install.
      created(1, schedule('sched-1', 1, NOW - 5_000)),
    ])

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(HooksLive)
          const hooks = Context.get(context, Hooks)
          yield* installScheduleRuns(agent, hooks, () => NOW)
          yield* Effect.sleep('50 millis')
        }),
      ),
    )

    expect(sent.map((message) => message.source)).toEqual(['schedule'])
  })

  test('a session with no schedules just waits', async () => {
    const { agent, sent } = fakeAgent([])

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(HooksLive)
          const hooks = Context.get(context, Hooks)
          yield* installScheduleRuns(agent, hooks, () => NOW)
          yield* Effect.sleep('20 millis')
        }),
      ),
    )

    expect(sent).toEqual([])
  })
})
