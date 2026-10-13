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
import { goalTool } from '../src/index.ts'

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

describe('goal tool', () => {
  test('records the objective and shows the note', async () => {
    const result = await Effect.runPromise(
      call(goalTool, { objective: 'ship v1', note: 'start with S6' }),
    )

    expect(result?.isError).toBe(false)
    expect(result?.value).toEqual({ objective: 'ship v1', note: 'start with S6' })
    expect(result?.content).toEqual([{ type: 'text', text: 'ship v1\nstart with S6' }])
  })

  test('a goal without a note is enough', async () => {
    const result = await Effect.runPromise(call(goalTool, { objective: 'ship v1' }))

    expect(result?.value).toEqual({ objective: 'ship v1' })
    expect(result?.content).toEqual([{ type: 'text', text: 'ship v1' }])
  })
})
