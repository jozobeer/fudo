import { HooksLive } from '@fudo/kernel'
import type { SandboxShape } from '@fudo/safety'
import {
  Tools,
  toolsLayer,
  type ToolDefinition,
  type ToolError,
  type ToolExecutionResult,
} from '@fudo/tools'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { makeBashTool } from '../src/index.ts'

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

describe('bash tool', () => {
  test('runs a command and returns its output', async () => {
    const result = await Effect.runPromise(call(makeBashTool(), { command: 'echo hi' }, '/tmp'))

    expect(result?.isError).toBe(false)
    expect(result?.value).toEqual({ exitCode: 0, stdout: 'hi\n', stderr: '' })
  })

  test('runs the command the sandbox wrapped', async () => {
    const wrapping: SandboxShape = {
      name: 'test',
      wrap: (command) =>
        Effect.succeed({ argv: ['bash', '-lc', 'echo wrapped'], cwd: command.cwd }),
    }

    const result = await Effect.runPromise(
      call(makeBashTool(wrapping), { command: 'echo raw' }, '/tmp'),
    )

    expect(result?.value).toEqual({ exitCode: 0, stdout: 'wrapped\n', stderr: '' })
  })

  test('a failing command is an error result with its output', async () => {
    const result = await Effect.runPromise(call(makeBashTool(), { command: 'exit 3' }, '/tmp'))

    expect(result?.isError).toBe(true)
    expect(result?.content).toEqual([{ type: 'text', text: expect.stringContaining('exit 3') }])
  })
})
