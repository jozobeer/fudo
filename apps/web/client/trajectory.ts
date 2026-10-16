import type { UiSessionEvent } from '@jozo-harness/ui-protocol'

/** One turn as the log recorded it: when it ran, what it did, how it ended. */
export interface TurnView {
  readonly turn: number
  readonly startedAt: number
  /** Undefined while the turn is still open. */
  readonly endedAt: number | undefined
  readonly steps: number
  readonly tools: number
  /** '' while the turn is open; the kind of reason once it closed. */
  readonly outcome: string
}

/** The event bodies arrive as unknown; the ledger counts nothing it cannot read. */
const fieldOf = (data: unknown, key: string): unknown =>
  typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined

/** How a turn ended, as its reason names it; '' when the body is not a reason. */
const outcomeOf = (data: unknown): string => {
  const kind = fieldOf(fieldOf(data, 'reason'), 'kind')
  return typeof kind === 'string' ? kind : ''
}

/** The last turn, replaced; the ones before it are already settled. */
const withLast = (turns: ReadonlyArray<TurnView>, last: TurnView): ReadonlyArray<TurnView> => [
  ...turns.slice(0, -1),
  last,
]

/** A turn that opened. */
const opened = (turns: ReadonlyArray<TurnView>, event: UiSessionEvent): ReadonlyArray<TurnView> => {
  const turn = fieldOf(event.data, 'turn')
  return typeof turn === 'number'
    ? [
        ...turns,
        { turn, startedAt: event.time, endedAt: undefined, steps: 0, tools: 0, outcome: '' },
      ]
    : turns
}

/** The turn that is open, closed with the reason the log gave. */
const closed = (turns: ReadonlyArray<TurnView>, event: UiSessionEvent): ReadonlyArray<TurnView> => {
  const last = turns[turns.length - 1]
  if (last === undefined || last.endedAt !== undefined) return turns
  return withLast(turns, { ...last, endedAt: event.time, outcome: outcomeOf(event.data) })
}

/** One more step or call on the turn that is open; a closed turn counts nothing more. */
const counted = (
  turns: ReadonlyArray<TurnView>,
  add: (turn: TurnView) => TurnView,
): ReadonlyArray<TurnView> => {
  const last = turns[turns.length - 1]
  if (last === undefined || last.endedAt !== undefined) return turns
  return withLast(turns, add(last))
}

/**
 * Adds one event to the ledger. Only what a turn did is counted: a start opens
 * one, a step and a call are added to the open one, and an end closes it with the
 * reason the log gave. Anything else leaves the ledger as it was.
 */
export const turnsAfter = (
  turns: ReadonlyArray<TurnView>,
  event: UiSessionEvent,
): ReadonlyArray<TurnView> => {
  if (event.type === 'turn/start') return opened(turns, event)
  if (event.type === 'turn/end') return closed(turns, event)
  if (event.type === 'step/start')
    return counted(turns, (turn) => ({ ...turn, steps: turn.steps + 1 }))
  if (event.type === 'tool/call')
    return counted(turns, (turn) => ({ ...turn, tools: turn.tools + 1 }))
  return turns
}
