import { describe, expect, test } from 'vitest'
import { startStubServer } from '../src/index.ts'

describe('startStubServer', () => {
  test('answers with what the handler returns', async () => {
    const server = await startStubServer(
      (request) =>
        new Response('asked for ' + new URL(request.url).pathname, {
          status: 201,
          headers: { 'x-stub': 'yes' },
        }),
    )

    const answer = await fetch(server.origin + '/thing')

    expect(answer.status).toBe(201)
    expect(answer.headers.get('x-stub')).toBe('yes')
    expect(await answer.text()).toBe('asked for /thing')
    await server.stop()
  })

  test('stops listening', async () => {
    const server = await startStubServer(() => new Response('gone'))

    await server.stop()

    await expect(fetch(server.origin + '/')).rejects.toThrow()
  })

  test('a body a POST carried reaches the handler', async () => {
    const server = await startStubServer(
      async (request) => new Response(JSON.stringify(await request.json())),
    )

    const answer = await fetch(server.origin + '/', {
      method: 'POST',
      body: JSON.stringify({ model: 'stub/model' }),
    })

    expect(await answer.json()).toEqual({ model: 'stub/model' })
    await server.stop()
  })

  test('a handler that throws answers 500 rather than hanging', async () => {
    const server = await startStubServer(() => {
      throw new Error('boom')
    })

    const answer = await fetch(server.origin + '/')

    expect(answer.status).toBe(500)
    await server.stop()
  })
})
