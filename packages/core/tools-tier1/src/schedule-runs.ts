import { Duration, Effect, Queue } from 'effect'
import type { HookRegistry } from '@fudo/kernel'
import type { Agent } from '@fudo/agent'
import type { SessionEvent } from '@fudo/session'
import {
  currentSchedules,
  lastFiredAt,
  renderSchedulePrompt,
  SCHEDULE_SOURCE,
  type Schedule,
} from './schedule-state.ts'
import { nextDue } from './schedule-time.ts'

/** A schedule whose time has come, or is still ahead. */
export interface PendingFire {
  readonly schedule: Schedule
  /** When it should fire; already past means it is due now. */
  readonly at: number
}

/** Every standing schedule's next firing, soonest first. Log in, list out. */
export const pendingFires = (events: ReadonlyArray<SessionEvent>): ReadonlyArray<PendingFire> =>
  currentSchedules(events)
    .flatMap((schedule) => {
      const at = nextDue(schedule.rule, schedule.createdAt, lastFiredAt(events, schedule.id))
      return at === undefined ? [] : [{ schedule, at: Math.max(at, 0) }]
    })
    .sort((left, right) => left.at - right.at || left.schedule.id.localeCompare(right.schedule.id))

/** What the driver fires next, or nothing while no schedule is standing. */
export const nextFire = (events: ReadonlyArray<SessionEvent>): PendingFire | undefined =>
  pendingFires(events)[0]

/** Records that a schedule came due and hands the model its instruction. */
export const fireSchedule = (
  agent: Agent,
  schedule: Schedule,
  now: () => number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const at = now()
    yield* agent.session
      .append('schedule/fired', { id: schedule.id, at })
      .pipe(Effect.catchCause(() => Effect.void))
    yield* agent
      .followup({ text: renderSchedulePrompt(schedule), source: SCHEDULE_SOURCE })
      .pipe(Effect.catchCause(() => Effect.void))
  })

/**
 * Keeps the clock for one session: sleeps until the soonest standing schedule is
 * due, fires it, and wakes early whenever a schedule changes. The schedules
 * themselves are read from the log every time, so a resumed session fires what it
 * missed and a deleted schedule never fires.
 */
export const installScheduleRuns = (
  agent: Agent,
  hooks: HookRegistry,
  now: () => number = Date.now,
): Effect.Effect<void, never, import('effect').Scope.Scope> =>
  Effect.gen(function* () {
    const changed = yield* Queue.unbounded<void>()
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        while (true) {
          const next = nextFire(agent.session.events())
          if (next === undefined) {
            yield* Queue.take(changed)
            continue
          }
          const wokeEarly = yield* Effect.race(
            Effect.sleep(Duration.millis(Math.max(next.at - now(), 1))).pipe(Effect.as(false)),
            Queue.take(changed).pipe(Effect.as(true)),
          )
          if (!wokeEarly) yield* fireSchedule(agent, next.schedule, now)
        }
      }),
    )
    yield* hooks.on('session/event', (event, session) => {
      if (session !== agent.session) return
      if (event.type.startsWith('schedule/')) Queue.offerUnsafe(changed, undefined)
    })
  })
