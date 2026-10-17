import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'
import { decodeSessionEvent, lastSkillCatalog } from '../src/index.ts'
import { event } from './support.ts'

describe('the skill catalog in the log', () => {
  test('a skill-catalog user message decodes from the log', async () => {
    const decoded = await Effect.runPromise(
      decodeSessionEvent({
        seq: 5,
        time: 1,
        type: 'user/message',
        data: { text: 'catalog', source: 'skill-catalog' },
      }),
    )

    expect(decoded?.type).toBe('user/message')
  })

  test('lastSkillCatalog returns the newest catalog text', () => {
    const events = [
      event(2, 'user/message', { text: 'first', source: 'skill-catalog' }),
      event(3, 'user/message', { text: 'the task', source: 'user' }),
      event(4, 'user/message', { text: 'second', source: 'skill-catalog' }),
    ]

    expect(lastSkillCatalog(events)).toBe('second')
  })

  test('an injected message is not a catalog', () => {
    expect(
      lastSkillCatalog([event(2, 'user/message', { text: 'note', source: 'inject' })]),
    ).toBeUndefined()
  })
})
