import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'
import { startStubServer } from '@jozo-harness/test-support-stub'
import { braveSearch } from '../src/index.ts'

describe('braveSearch', () => {
  test('parses the provider response', async () => {
    let seen: { url: string; token: string } = { url: '', token: '' }
    const server = await startStubServer((request) => {
      seen = {
        url: request.url,
        token: request.headers.get('x-subscription-token') ?? '',
      }
      return Response.json({
        web: {
          results: [
            { title: 'jozo-harness', url: 'https://example.com', description: 'a harness' },
            { url: 'https://example.com/2' },
          ],
        },
      })
    })
    const baseUrl = server.origin + '/search'

    const hits = await Effect.runPromise(
      braveSearch({ apiKey: 'secret', baseUrl }).search('jozo-harness', 2),
    )
    await server.stop()

    expect(hits).toEqual([
      { title: 'jozo-harness', url: 'https://example.com', snippet: 'a harness' },
      { title: '', url: 'https://example.com/2', snippet: '' },
    ])
    expect(seen.token).toBe('secret')
    expect(seen.url).toContain('q=jozo-harness')
    expect(seen.url).toContain('count=2')
  })

  test('a failing provider becomes a tool error', async () => {
    const server = await startStubServer(() => new Response('nope', { status: 500 }))
    const baseUrl = server.origin + '/search'

    const message = await Effect.runPromise(
      Effect.match(braveSearch({ apiKey: 'secret', baseUrl }).search('jozo-harness', 1), {
        onFailure: (error) => error.message,
        onSuccess: () => 'ok',
      }),
    )
    await server.stop()

    expect(message).toContain('search failed')
  })
})
