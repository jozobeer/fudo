import { describe, expect, test } from 'bun:test'
import { meterOf, thresholdOf, type TokenBudget } from '../src/index.ts'
import { event, headerEvent } from './support.ts'

/** Content of exactly this many UTF-8 bytes, made up so no input can be memorised. */
const textOfBytes = (size: number): string => {
  const tag = crypto.randomUUID().replace(/-/g, '')
  return tag + 'x'.repeat(size - tag.length)
}

const budget: TokenBudget = { contextWindow: 1000, thresholdRatio: 0.8, headroomTokens: 0 }

const userTurn = (seq: number, text: string) =>
  event(seq, 'user/message', { text, source: 'user' as const })

const assistantWithUsage = (seq: number, inputTokens: number, outputTokens: number) =>
  event(seq, 'assistant/message', {
    provider: 'p',
    model: 'm',
    content: [{ type: 'text' as const, text: 'answer' }],
    usage: { inputTokens, outputTokens },
    stream: [],
  })

describe('thresholdOf', () => {
  test('is the tighter of the window fraction and the room left after headroom', () => {
    expect(thresholdOf(budget)).toBe(800)
    expect(thresholdOf({ ...budget, headroomTokens: 300 })).toBe(700)
    expect(thresholdOf({ ...budget, thresholdRatio: 0.5 })).toBe(500)
  })
})

describe('meterOf', () => {
  test('estimates the request from bytes when the provider has not counted one', () => {
    const events = [headerEvent(), userTurn(2, textOfBytes(400))]

    const meter = meterOf(events, budget)

    expect(meter.source).toBe('bytes')
    expect(meter.estimated).toBe(100)
    expect(meter.remaining).toBe(700)
    expect(meter.compacts).toBe(false)
  })

  test('a request past the threshold is the one that compacts', () => {
    const events = [headerEvent(), userTurn(2, textOfBytes(4000))]

    const meter = meterOf(events, budget)

    expect(meter.estimated).toBe(1000)
    expect(meter.remaining).toBe(-200)
    expect(meter.compacts).toBe(true)
  })

  test('counts what the provider reported and only estimates what came after it', () => {
    const events = [
      headerEvent(),
      userTurn(2, textOfBytes(400)),
      assistantWithUsage(3, 100, 20),
      userTurn(4, textOfBytes(40)),
    ]

    const meter = meterOf(events, budget)

    expect(meter.source).toBe('usage')
    // The provider counted everything up to its answer; the newest message is estimated.
    expect(meter.estimated).toBe(130)
  })

  test('a tool result after the provider number is part of the estimate', () => {
    const events = [
      headerEvent(),
      userTurn(2, textOfBytes(400)),
      assistantWithUsage(3, 100, 20),
      event(4, 'tool/result', {
        callId: 'c1',
        isError: false,
        content: [{ type: 'text' as const, text: textOfBytes(400) }],
      }),
    ]

    const meter = meterOf(events, budget)

    expect(meter.estimated).toBe(220)
  })

  test('a recorded checkpoint lowers the estimate by the span it stopped carrying', () => {
    const events = [
      headerEvent(),
      userTurn(2, textOfBytes(4000)),
      assistantWithUsage(3, 1000, 20),
      userTurn(4, textOfBytes(40)),
    ]
    const summarized = [
      ...events,
      event(5, 'compaction/checkpoint', {
        shadowedSeqs: [2],
        shadowedRange: { start: 2, end: 2 },
        summary: 'condensed',
        provider: 'p',
        model: 'm',
      }),
    ]

    const before = meterOf(events, budget)
    const after = meterOf(summarized, budget)

    // The 4,000-byte message is no longer sent: the fold carries a short summary for it.
    expect(before.estimated).toBe(1_030)
    expect(after.estimated).toBeLessThan(100)
  })

  test('a context window too small for the headroom still leaves a threshold', () => {
    const events = [headerEvent(), userTurn(2, 'go')]

    const meter = meterOf(events, { contextWindow: 100, thresholdRatio: 0.8, headroomTokens: 200 })

    expect(meter.threshold).toBe(1)
    expect(meter.compacts).toBe(true)
  })
})
