import type { SessionEvent } from '@fudo/session'
import { describe, expect, test } from 'bun:test'
import { currentGoal, goalRounds, MIN_BLOCKED_ROUNDS } from '../src/index.ts'

const event = (seq: number, type: string, data: unknown): SessionEvent =>
  ({ seq, time: seq, type, data }) as unknown as SessionEvent

const goalEvent = (
  seq: number,
  objective: string,
  phase: string,
  extra: object = {},
): SessionEvent =>
  event(seq, 'goal/updated', {
    objective,
    phase,
    maxGoalRounds: 256,
    ...extra,
  })

const roundMessage = (seq: number): SessionEvent =>
  event(seq, 'user/message', { text: 'continue', source: 'goal-round' })

describe('the goal a session is working toward', () => {
  test('is the newest state the log recorded, and nothing when it recorded none', () => {
    expect(currentGoal([])).toBeUndefined()

    const events = [
      goalEvent(1, 'first aim', 'active'),
      event(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      goalEvent(3, 'first aim', 'paused'),
    ]

    expect(currentGoal(events)).toMatchObject({ objective: 'first aim', phase: 'paused' })
  })

  test('rounds are counted from the log, not from a counter', () => {
    const events = [
      goalEvent(1, 'aim', 'active'),
      roundMessage(2),
      event(3, 'user/message', { text: 'a human word', source: 'user' }),
      roundMessage(4),
    ]

    expect(goalRounds(events)).toBe(2)
    expect(goalRounds([])).toBe(0)
  })

  test('the minimum the policy names is three rounds', () => {
    expect(MIN_BLOCKED_ROUNDS).toBe(3)
  })
})
