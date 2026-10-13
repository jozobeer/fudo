import { HooksLive } from '@fudo/kernel'
import {
  Tools,
  toolsLayer,
  type ToolDefinition,
  type ToolError,
  type ToolExecutionResult,
} from '@fudo/tools'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { webFetchTool } from '../src/index.ts'

const call = (
  tool: ToolDefinition<any, any>,
  args: unknown,
): Effect.Effect<ToolExecutionResult | undefined, ToolError, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(Layer.provideMerge(toolsLayer, HooksLive))
      const tools = Context.get(context, Tools)
      yield* tools.register(tool)
      return yield* tools.call({
        callId: 'c1',
        tool: tool.name,
        arguments: JSON.stringify(args),
        context: { sessionId: 's1', cwd: '/tmp', callId: 'c1' },
      })
    }),
  )

describe('web_fetch tool', () => {
  test('reads a body from a local server', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response('hello from the server', { status: 200 }),
    })
    const url = 'http://127.0.0.1:' + String(server.port) + '/'

    const result = await Effect.runPromise(call(webFetchTool, { url }))

    expect(result?.isError).toBe(false)
    expect(result?.value).toEqual({
      url,
      status: 200,
      text: 'hello from the server',
      truncated: false,
    })
    await server.stop(true)
  })

  test('honours the byte limit', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response('abcdefghij', { status: 200 }),
    })
    const url = 'http://127.0.0.1:' + String(server.port) + '/'

    const result = await Effect.runPromise(call(webFetchTool, { url, maxBytes: 4 }))

    expect(result?.value).toEqual({ url, status: 200, text: 'abcd', truncated: true })
    await server.stop(true)
  })

  test('refuses a non-http url before calling out', async () => {
    const result = await Effect.runPromise(call(webFetchTool, { url: 'file:///etc/passwd' }))

    expect(result?.isError).toBe(true)
    expect(JSON.stringify(result?.content)).toContain('not an http(s) url')
  })
})
