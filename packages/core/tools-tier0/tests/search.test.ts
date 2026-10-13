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
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { globTool, grepTool } from '../src/index.ts'

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

const workspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fudo-search-'))
  await Bun.write(join(dir, 'a.ts'), 'const one = 1\n// needle\n')
  await Bun.write(join(dir, 'sub', 'b.ts'), 'const two = 2\n')
  await Bun.write(join(dir, 'c.md'), 'needle in markdown\n')
  return dir
}

describe('glob tool', () => {
  test('lists matching files sorted', async () => {
    const dir = await workspace()

    const result = await Effect.runPromise(call(globTool, { pattern: '**/*.ts' }, dir))

    expect(result?.value).toEqual({ files: ['a.ts', 'sub/b.ts'], truncated: false })
    await rm(dir, { recursive: true, force: true })
  })
})

describe('grep tool', () => {
  test('reports the file, line number, and text', async () => {
    const dir = await workspace()

    const result = await Effect.runPromise(
      call(grepTool, { pattern: 'needle', include: '**/*.ts' }, dir),
    )

    expect(result?.value).toEqual({
      matches: [{ file: 'a.ts', line: 2, text: '// needle' }],
      truncated: false,
    })
    await rm(dir, { recursive: true, force: true })
  })

  test('a bad pattern is rejected before scanning', async () => {
    const dir = await workspace()

    const result = await Effect.runPromise(call(grepTool, { pattern: '([' }, dir))

    expect(result?.isError).toBe(true)
    expect(JSON.stringify(result?.content)).toContain('bad pattern')
    await rm(dir, { recursive: true, force: true })
  })
})
