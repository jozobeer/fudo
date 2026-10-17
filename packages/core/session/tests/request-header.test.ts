import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'
import { decodeSessionEvent, lastRequestHeader, type RequestHeaderData } from '../src/index.ts'
import { event, headerEvent } from './support.ts'

const header = (series: number, tools: RequestHeaderData['tools']): RequestHeaderData => ({
  provider: 'ollama-cloud',
  model: 'qwen3-coder:480b',
  params: {},
  tools,
  series,
  reason: series === 1 ? 'opened' : 'changed',
})

describe('lastRequestHeader', () => {
  test('is undefined before any request', () => {
    expect(lastRequestHeader([])).toBeUndefined()
  })

  test('returns the newest header of the session', () => {
    const events = [
      headerEvent(),
      event(2, 'request/header', header(1, [])),
      event(3, 'user/message', { text: 'go', source: 'user' }),
      event(
        4,
        'request/header',
        header(2, [{ name: 'read', description: 'Reads', parameters: {} }]),
      ),
    ]

    expect(lastRequestHeader(events)?.series).toBe(2)
    expect(lastRequestHeader(events)?.reason).toBe('changed')
  })
})

describe('the request header in the log', () => {
  test('carries the tools the request was assembled with', async () => {
    const data = header(1, [
      {
        name: 'read',
        description: 'Reads a UTF-8 text file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ])

    const decoded = await Effect.runPromise(
      decodeSessionEvent({ seq: 2, time: 1, type: 'request/header', data }),
    )

    expect(decoded?.type).toBe('request/header')
    expect(decoded?.type === 'request/header' ? decoded.data.tools : []).toEqual(data.tools)
    expect(decoded?.type === 'request/header' ? decoded.data.series : 0).toBe(1)
  })

  test('refuses a header without its tools', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        decodeSessionEvent({
          seq: 2,
          time: 1,
          type: 'request/header',
          data: { provider: 'p', model: 'm', params: {}, series: 1, reason: 'opened' },
        }),
      ),
    )

    expect(error._tag).toBe('SessionError')
  })
})
