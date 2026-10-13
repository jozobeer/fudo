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
import { join } from 'node:path'
import { makeWorkingDirectoryTool } from '../src/index.ts'

const call = (
  tool: ToolDefinition<any, any>,
  args: unknown,
  cwd: string,
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
        context: { sessionId: 's1', cwd, callId: 'c1' },
      })
    }),
  )

describe('working_directory tool', () => {
  test('records a move inside the workspace', async () => {
    const moved: Array<string> = []
    const tool = makeWorkingDirectoryTool({
      root: '/work',
      change: (cwd) => Effect.sync(() => void moved.push(cwd)),
    })

    const result = await Effect.runPromise(call(tool, { path: 'sub/dir' }, '/work'))

    expect(result?.isError).toBe(false)
    expect(moved).toEqual([join('/', 'work', 'sub', 'dir')])
    expect(result?.value).toEqual({ cwd: join('/', 'work', 'sub', 'dir') })
  })

  test('refuses a move outside the workspace', async () => {
    const moved: Array<string> = []
    const tool = makeWorkingDirectoryTool({
      root: '/work',
      change: (cwd) => Effect.sync(() => void moved.push(cwd)),
    })

    const result = await Effect.runPromise(call(tool, { path: '../elsewhere' }, '/work'))

    expect(result?.isError).toBe(true)
    expect(moved).toEqual([])
    expect(JSON.stringify(result?.content)).toContain('escapes the workspace')
  })
})
