import { describe, expect, test } from 'bun:test'
import { applySpill, planSpill, SPILL_PREVIEW_CHARS, textOf } from '../src/index.ts'
import { Effect } from 'effect'

const blocks = (text: string) => [{ type: 'text' as const, text }]

describe('planSpill', () => {
  test('keeps a result inside the limit', () => {
    expect(planSpill(blocks('short'), 100)).toEqual({ kind: 'keep' })
  })

  test('spills a result over the limit and keeps a preview', () => {
    const long = 'x'.repeat(50) + '\n' + 'y'.repeat(50)
    const plan = planSpill(blocks(long), 20, 10)

    expect(plan.kind).toBe('spill')
    if (plan.kind !== 'spill') return
    expect(plan.text).toBe(long)
    expect(plan.preview).toBe('x'.repeat(10))
    expect(plan.bytes).toBe(101)
    expect(plan.lines).toBe(2)
  })

  test('counts bytes, not characters', () => {
    const plan = planSpill(blocks('あいうえお'), 5)

    expect(plan.kind).toBe('spill')
    if (plan.kind !== 'spill') return
    expect(plan.bytes).toBe(15)
  })
})

describe('textOf', () => {
  test('joins text blocks and ignores the rest', () => {
    expect(
      textOf([
        { type: 'text', text: 'a' },
        { type: 'reasoning', text: 'hidden' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab')
    expect(SPILL_PREVIEW_CHARS).toBe(2000)
  })
})

describe('applySpill', () => {
  const result = (text: string) => ({ isError: false, content: blocks(text) })

  test('writes a big result away and keeps a preview', async () => {
    const written: Array<{ callId: string; text: string }> = []
    const spilled = await Effect.runPromise(
      applySpill(result('x'.repeat(100)), 'c1', {
        maxSpillBytes: 10,
        spill: (callId, text) =>
          Effect.sync(() => {
            written.push({ callId, text })
            return 'spill/c1.txt'
          }),
      }),
    )

    expect(written).toEqual([{ callId: 'c1', text: 'x'.repeat(100) }])
    const first = spilled.content[0]
    expect(first?.type === 'text' ? first.text : '').toContain(
      '[spilled to spill/c1.txt: 1 lines, 100 bytes]',
    )
    expect(first?.type === 'text' ? first.text.length : 0).toBeGreaterThan(50)
  })

  test('keeps a small result and never writes', async () => {
    let writes = 0
    const kept = await Effect.runPromise(
      applySpill(result('small'), 'c1', {
        maxSpillBytes: 100,
        spill: () =>
          Effect.sync(() => {
            writes += 1
            return 'x'
          }),
      }),
    )

    expect(kept.content).toEqual(blocks('small'))
    expect(writes).toBe(0)
  })

  test('leaves an error result alone', async () => {
    const failed = await Effect.runPromise(
      applySpill({ isError: true, content: blocks('boom'.repeat(50)) }, 'c1', {
        maxSpillBytes: 1,
        spill: () => Effect.succeed('x'),
      }),
    )

    expect(failed.isError).toBe(true)
    expect(failed.content).toEqual(blocks('boom'.repeat(50)))
  })
})
