import { describe, expect, test } from 'bun:test'
import {
  compactAssistantStream,
  expandAssistantStream,
  type StreamChunk,
  type TimedStreamChunk,
} from '../src/index.ts'

const fragment = (): string => crypto.randomUUID().slice(0, 6)

describe('compactAssistantStream', () => {
  test('merges consecutive text deltas of one block and keeps their times', () => {
    const first = fragment()
    const second = fragment()
    const third = fragment()

    const records = compactAssistantStream([
      { time: 100, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
      { time: 110, chunk: { type: 'text-delta', index: 0, text: first } },
      { time: 125, chunk: { type: 'text-delta', index: 0, text: second } },
      { time: 140, chunk: { type: 'text-delta', index: 0, text: third } },
      {
        time: 150,
        chunk: {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: first + second + third },
        },
      },
    ])

    expect(records).toEqual([
      { type: 'chunk', time: 100, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
      { type: 'text-chunks', time0: 110, index: 0, dt: [15, 15], texts: [first, second, third] },
      {
        type: 'chunk',
        time: 150,
        chunk: {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: first + second + third },
        },
      },
    ])
  })

  test('keeps a tool-call run only while id and name stay identical', () => {
    const id = crypto.randomUUID()
    const first = fragment()
    const second = fragment()

    const records = compactAssistantStream([
      {
        time: 1,
        chunk: { type: 'tool-call-delta', index: 2, id, name: 'read', argumentsDelta: first },
      },
      { time: 3, chunk: { type: 'tool-call-delta', index: 2, id, argumentsDelta: second } },
    ])

    expect(records).toEqual([
      { type: 'tool-call-chunks', time0: 1, index: 2, dt: [], id, name: 'read', args: [first] },
      { type: 'tool-call-chunks', time0: 3, index: 2, dt: [], id, args: [second] },
    ])
  })

  test('round-trips a generated stream without losing a delta boundary', () => {
    const chunks = randomChunks(42)
    expect(expandAssistantStream(compactAssistantStream(chunks))).toEqual(chunks)
  })

  test('round-trips an empty stream', () => {
    expect(expandAssistantStream(compactAssistantStream([]))).toEqual([])
  })
})

/** Deterministic chunk generator; values come from the runtime, not the source. */
function randomChunks(seed: number): ReadonlyArray<TimedStreamChunk> {
  let state = seed
  const next = (): number => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state
  }
  const word = (): string => next().toString(36).slice(0, 5)
  const chunks: TimedStreamChunk[] = []
  let time = 1000
  const callId = crypto.randomUUID()
  for (let index = 0; index < 36; index += 1) {
    time += 1 + (next() % 5)
    const pick = next() % 7
    let chunk: StreamChunk
    switch (pick) {
      case 0:
        chunk = { type: 'text-delta', index: 0, text: word() }
        break
      case 1:
        chunk = { type: 'reasoning-delta', index: 1, text: word() }
        break
      case 2:
        chunk = { type: 'tool-call-delta', index: 2, id: callId, argumentsDelta: word() }
        break
      case 3:
        chunk = {
          type: 'tool-call-delta',
          index: 2,
          id: callId,
          name: 'read',
          argumentsDelta: word(),
        }
        break
      case 4:
        chunk = { type: 'block-end', index: 0, block: { type: 'text', text: word() } }
        break
      case 5:
        chunk = { type: 'usage', usage: { inputTokens: next() % 100, outputTokens: next() % 100 } }
        break
      default:
        chunk = { type: 'finish', kind: 'stop' }
        break
    }
    chunks.push({ time, chunk })
  }
  return chunks
}
