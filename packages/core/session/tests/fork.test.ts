import type { SessionEvent } from '../src/index.ts'
import { describe, expect, test } from 'vitest'
import { forkSeed } from '../src/index.ts'

const header: SessionEvent = {
  seq: 1,
  time: 0,
  type: 'session/header',
  data: { formatVersion: 1, createdAt: 0, cwd: '/work' },
}
const user = (seq: number, text: string): SessionEvent => ({
  seq,
  time: 0,
  type: 'user/message',
  data: { text, source: 'user' },
})
const assistant = (seq: number, text: string): SessionEvent =>
  ({
    seq,
    time: 0,
    type: 'assistant/message',
    data: {
      provider: 'stub',
      model: 'stub',
      stream: [],
      content: [{ type: 'text' as const, text }],
    },
  }) as SessionEvent

describe('forkSeed', () => {
  test('drops the last user message', () => {
    const events = [header, user(2, 'first'), assistant(3, 'ok'), user(4, 'second')]

    expect(forkSeed(events).map((event) => event.seq)).toEqual([1, 2, 3])
  })

  test('keeps everything when the user has not spoken yet', () => {
    const events = [header, assistant(2, 'hello')]

    expect(forkSeed(events).map((event) => event.seq)).toEqual([1, 2])
  })

  test('an empty log forks to nothing', () => {
    expect(forkSeed([])).toEqual([])
  })
})
