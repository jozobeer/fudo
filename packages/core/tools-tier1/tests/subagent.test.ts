import type { Agent, AgentsShape } from '@fudo/agent'
import { HooksLive } from '@fudo/kernel'
import type { SessionEvent } from '@fudo/session'
import {
  Tools,
  toolsLayer,
  type ToolDefinition,
  type ToolError,
  type ToolExecutionResult,
} from '@fudo/tools'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { makeSubagentTool } from '../src/index.ts'

const childEvents = (text: string): Array<SessionEvent> =>
  [
    {
      seq: 1,
      time: 0,
      type: 'session/header',
      data: { formatVersion: 1, createdAt: 0, cwd: '/tmp' },
    },
    {
      seq: 2,
      time: 0,
      type: 'assistant/message',
      data: { content: [{ type: 'text', text }] },
    },
  ] as unknown as Array<SessionEvent>

const fakeAgents = (seen: Array<{ cwd: string; task: string }>, text: string): AgentsShape =>
  ({
    create: (options: { cwd: string }) => {
      seen.push({ cwd: options.cwd, task: '' })
      const agent = {
        id: 'child-1',
        session: { events: () => childEvents(text) },
        followup: (message: { text: string }) =>
          Effect.sync(() => {
            seen[seen.length - 1] = { cwd: options.cwd, task: message.text }
          }),
        whenIdle: Effect.void,
      } as unknown as Agent
      return Effect.succeed(agent)
    },
  }) as unknown as AgentsShape

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
        context: { sessionId: 's1', cwd: '/work', callId: 'c1' },
      })
    }),
  )

describe('subagent tool', () => {
  test('runs the task in a child and returns its answer', async () => {
    const seen: Array<{ cwd: string; task: string }> = []
    const result = await Effect.runPromise(
      call(
        makeSubagentTool({
          agents: fakeAgents(seen, 'child says hi'),
          route: 'stub/model',
          parentEvents: () => [],
        }),
        {
          task: 'look around',
        },
      ),
    )

    expect(result?.isError).toBe(false)
    expect(result?.value).toEqual({ sessionId: 'child-1', text: 'child says hi' })
    expect(JSON.stringify(result?.content)).toContain('[child session: child-1]')
    expect(seen).toEqual([{ cwd: '/work', task: 'look around' }])
  })

  test('takes the cwd it is given', async () => {
    const seen: Array<{ cwd: string; task: string }> = []
    await Effect.runPromise(
      call(
        makeSubagentTool({
          agents: fakeAgents(seen, 'ok'),
          route: 'stub/model',
          parentEvents: () => [],
        }),
        {
          task: 'go',
          cwd: '/elsewhere',
        },
      ),
    )

    expect(seen[0]?.cwd).toBe('/elsewhere')
  })
})
