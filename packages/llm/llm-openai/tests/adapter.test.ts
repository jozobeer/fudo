import { describe, expect, test } from 'bun:test'
import { LlmFailure, type LlmRequest } from '@fudo/llm'
import { Effect, Stream } from 'effect'
import { openAiAdapter } from '../src/index.ts'

const request: LlmRequest = {
  provider: 'ollama-cloud',
  model: 'deepseek-v4.1-flash',
  messages: [
    { role: 'system', content: [{ type: 'text', text: 'be brief' }] },
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'c1', name: 'echo', arguments: '{"text":"a"}' }],
    },
    { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ping' }] },
  ],
  tools: [{ name: 'echo', description: 'Echo', parameters: { type: 'object' } }],
  params: {},
}

const adapter = (response: Response) =>
  openAiAdapter({
    baseUrl: 'https://example.test/v1',
    apiKey: () => 'key',
    capabilities: {
      toolChoice: false,
      reasoningEffort: null,
      images: 'none',
      promptCacheControl: false,
    },
    fetch: (() => Promise.resolve(response)) as unknown as typeof fetch,
  })

const collect = (response: Response) => Stream.runCollect(adapter(response).stream(request))

describe('openAiAdapter', () => {
  test('encodes messages, tools, and stream options, then decodes the SSE body', async () => {
    const bodies: Array<string> = []
    const fixture = await Bun.file(
      new URL('../fixtures/ollama-cloud-tool-call.sse', import.meta.url),
    ).text()
    const streaming = openAiAdapter({
      baseUrl: 'https://example.test/v1/',
      apiKey: () => 'key',
      capabilities: {
        toolChoice: false,
        reasoningEffort: null,
        images: 'none',
        promptCacheControl: false,
      },
      fetch: ((url: string, init: RequestInit) => {
        bodies.push(String(url))
        bodies.push(String(init.body))
        return Promise.resolve(new Response(fixture, { status: 200 }))
      }) as unknown as typeof fetch,
    })

    const chunks = await Effect.runPromise(Stream.runCollect(streaming.stream(request)))
    const sent = JSON.parse(bodies[1] ?? '{}') as Record<string, unknown>

    expect(bodies[0]).toBe('https://example.test/v1/chat/completions')
    expect(sent.stream).toBe(true)
    expect(sent.stream_options).toEqual({ include_usage: true })
    expect((sent.tools as ReadonlyArray<unknown>)[0]).toMatchObject({ type: 'function' })
    expect([...chunks].some((chunk) => chunk.type === 'finish')).toBe(true)
    expect([...chunks].some((chunk) => chunk.type === 'usage')).toBe(true)
  })

  test('an HTTP error becomes an AUTH LlmFailure', async () => {
    const error = await Effect.runPromise(
      Effect.flip(collect(new Response('nope', { status: 401 }))),
    )
    expect(error).toBeInstanceOf(LlmFailure)
    expect(error.code).toBe('AUTH')
  })

  test('a rejected fetch becomes a TRANSPORT LlmFailure', async () => {
    const failing = openAiAdapter({
      baseUrl: 'https://example.test/v1',
      apiKey: () => 'key',
      capabilities: {
        toolChoice: false,
        reasoningEffort: null,
        images: 'none',
        promptCacheControl: false,
      },
      fetch: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
    })
    const error = await Effect.runPromise(Effect.flip(Stream.runCollect(failing.stream(request))))
    expect(error.code).toBe('TRANSPORT')
  })
})
