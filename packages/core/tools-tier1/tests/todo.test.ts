import { HooksLive } from '@fudo/kernel'
import { Tools, toolsLayer, type ToolError, type ToolExecutionResult } from '@fudo/tools'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { todoWriteTool } from '../src/index.ts'

const call = (args: unknown): Effect.Effect<ToolExecutionResult | undefined, ToolError, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(Layer.provideMerge(toolsLayer, HooksLive))
      const tools = Context.get(context, Tools)
      yield* tools.register(todoWriteTool)
      return yield* tools.call({
        callId: 'c1',
        tool: 'todo_write',
        arguments: JSON.stringify(args),
        context: { sessionId: 's1', cwd: '/tmp', callId: 'c1' },
      })
    }),
  )

describe('todo_write', () => {
  test('counts the statuses and renders marks', async () => {
    const result = await Effect.runPromise(
      call({
        todos: [
          { content: 'read the code', status: 'completed' },
          { content: 'write the test', status: 'in_progress' },
          { content: 'ship it', status: 'pending' },
        ],
      }),
    )

    expect(result?.isError).toBe(false)
    expect(result?.value).toEqual({
      todos: [
        { content: 'read the code', status: 'completed' },
        { content: 'write the test', status: 'in_progress' },
        { content: 'ship it', status: 'pending' },
      ],
      counts: { pending: 1, inProgress: 1, completed: 1 },
    })
    expect(result?.content).toEqual([
      { type: 'text', text: '[x] read the code\n[~] write the test\n[ ] ship it' },
    ])
  })

  test('a bad status is rejected before running', async () => {
    const result = await Effect.runPromise(call({ todos: [{ content: 'x', status: 'done' }] }))

    expect(result?.isError).toBe(true)
  })
})
