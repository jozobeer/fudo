import { describe, expect, test } from 'bun:test'
import { groupCalls } from '../src/index.ts'

const safe = (name: string) => name === 'read' || name === 'grep'
const names = (batches: ReadonlyArray<{ parallel: boolean; calls: ReadonlyArray<string> }>) =>
  batches.map((batch) => (batch.parallel ? batch.calls.join('+') : batch.calls[0]))

describe('groupCalls', () => {
  test('joins consecutive safe calls and keeps the rest apart', () => {
    const batches = groupCalls(['read', 'grep', 'bash', 'read'], safe)

    expect(names(batches)).toEqual(['read+grep', 'bash', 'read'])
    expect(batches.map((batch) => batch.parallel)).toEqual([true, false, false])
  })

  test('a single safe call is not a parallel batch', () => {
    expect(names(groupCalls(['read'], safe))).toEqual(['read'])
    expect(groupCalls(['read'], safe)[0]?.parallel).toBe(false)
  })

  test('unsafe calls keep their order', () => {
    expect(names(groupCalls(['bash', 'write', 'bash'], safe))).toEqual(['bash', 'write', 'bash'])
  })

  test('an empty list makes no batches', () => {
    expect(groupCalls([], safe)).toEqual([])
  })
})
