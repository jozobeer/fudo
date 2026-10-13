import { describe, expect, test } from 'bun:test'
import { planSpill, SPILL_PREVIEW_CHARS, textOf } from '../src/index.ts'

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
