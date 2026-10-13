import { describe, expect, test } from 'bun:test'
import { LlmFailure } from '@fudo/llm'
import type { RequestMessage } from '@fudo/llm'
import { deriveMessages, type MessageProjection } from '../src/index.ts'
import { event, headerEvent } from './support.ts'

describe('deriveMessages', () => {
  test('folds the model-visible events and skips attempts and metadata', () => {
    const events = [
      headerEvent(),
      event(2, 'system/message', { text: 'be brief' }),
      event(3, 'turn/start', { turn: 1 }),
      event(4, 'user/message', { text: 'hello', source: 'user' }),
      event(5, 'assistant/message', {
        provider: 'ollama-cloud',
        model: 'qwen3-coder:480b',
        content: [{ type: 'text', text: 'hi' }],
        usage: undefined,
        replayState: undefined,
        stream: [],
      }),
      event(6, 'tool/call', { callId: 'call-1', name: 'read', arguments: '{"path":"a"}' }),
      event(7, 'assistant/message', {
        provider: 'ollama-cloud',
        model: 'qwen3-coder:480b',
        content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"a"}' }],
        usage: undefined,
        replayState: undefined,
        stream: [],
      }),
      event(8, 'tool/result', {
        callId: 'call-1',
        isError: false,
        content: [{ type: 'text', text: 'file body' }],
      }),
      event(9, 'assistant/attempt', {
        provider: 'ollama-cloud',
        model: 'qwen3-coder:480b',
        failure: new LlmFailure({ code: 'TIMEOUT', message: 'no response' }),
        stream: [],
      }),
      event(10, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]

    expect(deriveMessages(events)).toEqual([
      { role: 'system', content: [{ type: 'text', text: 'be brief' }] },
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"a"}' }],
      },
      { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: 'file body' }] },
    ])
  })

  test('applies projections in order over the full event list', () => {
    const events = [
      headerEvent(),
      event(2, 'user/message', { text: 'first', source: 'user' }),
      event(3, 'user/message', { text: 'second', source: 'inject' }),
    ]
    const seen: Array<number> = []
    const dropInjected: MessageProjection = {
      name: 'drop-injected',
      project: (messages) => {
        seen.push(messages.length)
        return messages.filter((_message, index) => index !== 1)
      },
    }
    const rename: MessageProjection = {
      name: 'rename',
      project: (messages): ReadonlyArray<RequestMessage> =>
        messages.map((message) => ({ ...message, role: 'assistant' as const })),
    }

    const derived = deriveMessages(events, [dropInjected, rename])

    expect(seen).toEqual([2])
    expect(derived).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'first' }] }])
  })
})
