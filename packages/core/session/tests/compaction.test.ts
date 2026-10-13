import { describe, expect, test } from 'bun:test'
import { compactMessages } from '../src/index.ts'

const user = (text: string) => ({
  role: 'user' as const,
  content: [{ type: 'text' as const, text }],
})
const tool = (text: string) => ({
  role: 'tool' as const,
  content: [{ type: 'text' as const, text }],
  toolCallId: 'c1',
})

describe('compactMessages', () => {
  test('leaves a short history alone', () => {
    const result = compactMessages([user('hi'), tool('small')], { keepLast: 1, maxBytes: 100 })

    expect(result.shortened).toBe(0)
    expect(result.messages[0]).toEqual(user('hi'))
  })

  test('shortens old output and drops reasoning', () => {
    const long = 'x'.repeat(500)
    const withReasoning = {
      role: 'assistant' as const,
      content: [
        { type: 'reasoning' as const, text: 'thinking' },
        { type: 'text' as const, text: long },
      ],
    }

    const result = compactMessages([withReasoning, user('go')], { keepLast: 1, maxBytes: 100 })

    expect(result.shortened).toBe(1)
    const first = result.messages[0]
    expect(first?.content).toHaveLength(1)
    expect(first?.content[0]?.type === 'text' ? first.content[0].text : '').toContain(
      '[earlier output of 500 bytes]',
    )
  })

  test('never touches the newest messages', () => {
    const long = 'y'.repeat(500)
    const result = compactMessages([user('a'), tool(long)], { keepLast: 1, maxBytes: 10 })

    expect(result.shortened).toBe(0)
    expect(result.messages[1]).toEqual(tool(long))
  })
})
