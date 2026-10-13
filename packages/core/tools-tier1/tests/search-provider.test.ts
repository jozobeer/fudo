import { Effect } from 'effect'
import { describe, expect, test } from 'bun:test'
import { braveSearch } from '../src/index.ts'

describe('braveSearch', () => {
  test('parses the provider response', async () => {
    let seen: { url: string; token: string } = { url: '', token: '' }
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        seen = {
          url: request.url,
          token: request.headers.get('x-subscription-token') ?? '',
        }
        return Response.json({
          web: {
            results: [
              { title: 'fudo', url: 'https://example.com', description: 'a harness' },
              { url: 'https://example.com/2' },
            ],
          },
        })
      },
    })
    const baseUrl = 'http://127.0.0.1:' + String(server.port) + '/search'

    const hits = await Effect.runPromise(
      braveSearch({ apiKey: 'secret', baseUrl }).search('fudo', 2),
    )
    await server.stop(true)

    expect(hits).toEqual([
      { title: 'fudo', url: 'https://example.com', snippet: 'a harness' },
      { title: '', url: 'https://example.com/2', snippet: '' },
    ])
    expect(seen.token).toBe('secret')
    expect(seen.url).toContain('q=fudo')
    expect(seen.url).toContain('count=2')
  })

  test('a failing provider becomes a tool error', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('nope', { status: 500 }) })
    const baseUrl = 'http://127.0.0.1:' + String(server.port) + '/search'

    const message = await Effect.runPromise(
      Effect.match(braveSearch({ apiKey: 'secret', baseUrl }).search('fudo', 1), {
        onFailure: (error) => error.message,
        onSuccess: () => 'ok',
      }),
    )
    await server.stop(true)

    expect(message).toContain('search failed')
  })
})
