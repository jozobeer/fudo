import { describe, expect, test } from 'vitest'
import type { UiSessionEvent } from '@jozo-harness/ui-protocol'
import { turnsAfter, type TurnView } from '../client/trajectory.ts'

const event = (type: string, data: unknown, time: number): UiSessionEvent => ({
  seq: time,
  time,
  type,
  data,
})

const fold = (events: ReadonlyArray<UiSessionEvent>): ReadonlyArray<TurnView> =>
  events.reduce(turnsAfter, [])

describe('the turn ledger', () => {
  test('a turn counts its steps and its calls, and closes with its reason', () => {
    const turns = fold([
      event('session/header', { cwd: '/work' }, 1),
      event('turn/start', { turn: 1 }, 10),
      event('step/start', { step: 1 }, 11),
      event('tool/call', { callId: 'c1', name: 'read', arguments: '{}' }, 12),
      event('step/end', { step: 1 }, 13),
      event('step/start', { step: 2 }, 14),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 40),
    ])
    expect(turns).toEqual([
      { turn: 1, startedAt: 10, endedAt: 40, steps: 2, tools: 1, outcome: 'completed' },
    ])
  })

  test('a turn that is still open has no end and no reason', () => {
    const turns = fold([event('turn/start', { turn: 7 }, 5)])
    expect(turns).toEqual([
      { turn: 7, startedAt: 5, endedAt: undefined, steps: 0, tools: 0, outcome: '' },
    ])
  })

  test('a body the ledger cannot read is not counted', () => {
    const turns = fold([
      event('turn/start', { turn: 'first' }, 5),
      event('step/start', { step: 1 }, 6),
      event('tool/call', { callId: 'c1', name: 'read', arguments: '{}' }, 7),
      event('turn/end', { turn: 1, reason: 'completed' }, 8),
    ])
    expect(turns).toEqual([])
  })

  test('an end closes the open turn, and a second one changes nothing', () => {
    const turns = fold([
      event('turn/start', { turn: 1 }, 5),
      event('turn/end', { turn: 1, reason: { kind: 'cancelled' } }, 6),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 7),
      event('step/start', { step: 1 }, 8),
    ])
    expect(turns).toEqual([
      { turn: 1, startedAt: 5, endedAt: 6, steps: 0, tools: 0, outcome: 'cancelled' },
    ])
  })
})
