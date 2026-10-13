import { HooksLive } from '@fudo/kernel'
import { Tools, toolsLayer, type ToolError, type ToolExecutionResult } from '@fudo/tools'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeTool } from '../src/index.ts'

const call = (
  args: unknown,
  cwd: string,
): Effect.Effect<ToolExecutionResult | undefined, ToolError, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(Layer.provideMerge(toolsLayer, HooksLive))
      const tools = Context.get(context, Tools)
      yield* tools.register(writeTool)
      return yield* tools.call({
        callId: 'c1',
        tool: 'write',
        arguments: JSON.stringify(args),
        context: { sessionId: 's1', cwd, callId: 'c1' },
      })
    }),
  )

describe('write tool', () => {
  test('creates parent directories and reports the size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fudo-write-'))

    const result = await Effect.runPromise(call({ path: 'a/b.txt', content: 'hi\nthere' }, dir))

    expect(result?.isError).toBe(false)
    expect(result?.value).toEqual({ path: join(dir, 'a', 'b.txt'), bytes: 8 })
    expect(await Bun.file(join(dir, 'a', 'b.txt')).text()).toBe('hi\nthere')
    await rm(dir, { recursive: true, force: true })
  })

  test('refuses a path outside the workspace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fudo-write-'))

    const result = await Effect.runPromise(call({ path: '../escape.txt', content: 'x' }, dir))

    expect(result?.isError).toBe(true)
    expect(result?.content).toEqual([
      { type: 'text', text: expect.stringContaining('escapes the workspace') },
    ])
    await rm(dir, { recursive: true, force: true })
  })
})
