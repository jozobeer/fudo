import { describe, expect, test } from 'bun:test'
import { lastRuntimeContext } from '../src/index.ts'
import { event } from './support.ts'

describe('lastRuntimeContext', () => {
  test('is undefined before any snapshot', () => {
    expect(lastRuntimeContext([])).toBeUndefined()
  })

  test('returns the newest snapshot, not the newest user message', () => {
    const events = [
      event(2, 'user/message', { text: 'first', source: 'runtime-context' }),
      event(3, 'user/message', { text: 'do the task', source: 'user' }),
      event(4, 'user/message', { text: 'second', source: 'runtime-context' }),
      event(5, 'assistant/message', {
        provider: 'p',
        model: 'm',
        content: [],
        stream: [],
      }),
    ]

    expect(lastRuntimeContext(events)).toBe('second')
  })

  test('an injected message is not a snapshot', () => {
    const events = [event(2, 'user/message', { text: 'note', source: 'inject' })]

    expect(lastRuntimeContext(events)).toBeUndefined()
  })
})
