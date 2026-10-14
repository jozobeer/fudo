import { describe, expect, test } from 'bun:test'
import { dshMetrics, fudoMetrics } from './metrics.ts'

/** The two shapes, as the logs actually carry them. */
const fudoEvents = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'tool/call', data: { callId: 'c1', name: 'read', arguments: '{"path":"src/a.ts"}' } },
  { type: 'tool/result', data: { callId: 'c1', isError: false } },
  { type: 'tool/call', data: { callId: 'c2', name: 'read', arguments: '{"path":"src/a.ts"}' } },
  { type: 'tool/result', data: { callId: 'c2', isError: false } },
  { type: 'tool/call', data: { callId: 'c3', name: 'edit', arguments: '{"path":"src/a.ts"}' } },
  { type: 'tool/result', data: { callId: 'c3', isError: true } },
]

const dshEvents = [
  { type: 'turn/start', data: { turn: 1 } },
  {
    type: 'tool/call',
    data: { callId: 'd1', name: 'read', arguments: '{"file_path":"src/b.ts"}' },
  },
  { type: 'tool/result', data: { message: { toolCallId: 'd1', isError: false } } },
  {
    type: 'tool/call',
    data: { callId: 'd2', name: 'read', arguments: '{"file_path":"src/b.ts"}' },
  },
  { type: 'tool/result', data: { message: { toolCallId: 'd2', isError: false } } },
  { type: 'tool/call', data: { callId: 'd3', name: 'edit', arguments: '{"path":"src/b.ts"}' } },
  { type: 'tool/result', data: { message: { toolCallId: 'd3', isError: true } } },
]

describe('the A/B counters', () => {
  test('count the same story from the fudo log', () => {
    const metrics = fudoMetrics(fudoEvents)

    expect(metrics.toolCalls).toBe(3)
    expect(metrics.reReads).toBe(1)
    expect(metrics.failedEdits).toBe(1)
    expect(metrics.turns).toBe(1)
    expect(metrics.tools['read']).toBe(2)
  })

  test('count the same story from the dsh log', () => {
    const metrics = dshMetrics(dshEvents)

    expect(metrics.toolCalls).toBe(3)
    expect(metrics.reReads).toBe(1)
    expect(metrics.failedEdits).toBe(1)
    expect(metrics.turns).toBe(1)
    expect(metrics.tools['edit']).toBe(1)
  })

  test('a failed edit is not counted as a re-read, and other failures are not edits', () => {
    const metrics = fudoMetrics([
      { type: 'tool/call', data: { callId: 'x', name: 'read', arguments: '{"path":"a"}' } },
      { type: 'tool/result', data: { callId: 'x', isError: true } },
      { type: 'tool/call', data: { callId: 'y', name: 'read', arguments: '{"path":"a"}' } },
      { type: 'tool/result', data: { callId: 'y', isError: false } },
    ])

    expect(metrics.failedEdits).toBe(0)
    expect(metrics.reReads).toBe(1)
  })
})
