import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { listModels, modelEndpointOf } from '../src/models.ts'

const randomIds = (count: number): Array<string> =>
  Array.from({ length: count }, () => 'm-' + crypto.randomUUID().slice(0, 8))

const serveModels = (ids: ReadonlyArray<string>, status = 200) => {
  const headers: Array<string | null> = []
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      headers.push(request.headers.get('authorization'))
      return new URL(request.url).pathname === '/v1/models'
        ? Response.json(
            { object: 'list', data: ids.map((id) => ({ id, object: 'model' })) },
            {
              status,
            },
          )
        : new Response('not found', { status: 404 })
    },
  })
  return { server, headers, baseUrl: `http://127.0.0.1:${server.port}/v1` }
}

describe('listModels', () => {
  test('lists every id as a sorted route under the provider', async () => {
    const ids = randomIds(5)
    const { server, baseUrl } = serveModels(ids)

    const routes = await Effect.runPromise(
      listModels({ provider: 'acme', baseUrl, apiKeyEnv: 'ACME_KEY' }, {}),
    )

    server.stop(true)
    expect(routes).toEqual(ids.map((id) => 'acme/' + id).sort())
  })

  test('sends the key as a bearer token only when there is one', async () => {
    const { server, headers, baseUrl } = serveModels(randomIds(1))
    const endpoint = { provider: 'acme', baseUrl, apiKeyEnv: 'ACME_KEY' }
    const key = crypto.randomUUID()

    await Effect.runPromise(listModels(endpoint, { ACME_KEY: key }))
    await Effect.runPromise(listModels(endpoint, { ACME_KEY: '' }))

    server.stop(true)
    expect(headers).toEqual(['Bearer ' + key, null])
  })

  test('a failed status stops with the status and the url', async () => {
    const { server, baseUrl } = serveModels([], 401)

    const error = await Effect.runPromise(
      Effect.flip(listModels({ provider: 'acme', baseUrl, apiKeyEnv: 'ACME_KEY' }, {})),
    )

    server.stop(true)
    expect(error.message).toContain('HTTP 401')
    expect(error.message).toContain(baseUrl + '/models')
  })

  test('an empty list is an error, not a silent nothing', async () => {
    const { server, baseUrl } = serveModels([])

    const error = await Effect.runPromise(
      Effect.flip(listModels({ provider: 'acme', baseUrl, apiKeyEnv: 'ACME_KEY' }, {})),
    )

    server.stop(true)
    expect(error.message).toContain('no models')
  })
})

describe('modelEndpointOf', () => {
  const llmRow = (baseUrl: string) => ({
    id: 'llm',
    name: '@jozo-harness/llm-openai',
    config: { baseUrl, apiKeyEnv: 'OLLAMA_API_KEY' },
  })

  test('a known base url takes the route prefix of its provider', () => {
    expect(
      modelEndpointOf([
        { id: 'kernel', name: '@jozo-harness/kernel' },
        llmRow('https://ollama.com/v1'),
      ]),
    ).toEqual({
      provider: 'ollama-cloud',
      baseUrl: 'https://ollama.com/v1',
      apiKeyEnv: 'OLLAMA_API_KEY',
    })
  })

  test('an unknown base url falls back to its host name', () => {
    expect(modelEndpointOf([llmRow('http://127.0.0.1:11434/v1')])?.provider).toBe('127.0.0.1')
  })

  test('a profile without the openai row has no endpoint', () => {
    expect(modelEndpointOf([{ id: 'kernel', name: '@jozo-harness/kernel' }])).toBeUndefined()
    expect(
      modelEndpointOf([{ ...llmRow('https://ollama.com/v1'), disabled: true }]),
    ).toBeUndefined()
  })
})
