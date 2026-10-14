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
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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

const textOf = (result: ToolExecutionResult | undefined): string =>
  (result?.content ?? []).flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')

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

  test('does not walk node_modules', async () => {
    const dir = await workspace()
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true })
    await Bun.write(join(dir, 'node_modules', 'pkg', 'index.ts'), 'export {}\n')

    const result = await Effect.runPromise(call(globTool, { pattern: '**/*.ts' }, dir))

    expect(result?.value).toEqual({ files: ['a.ts', 'sub/b.ts'], truncated: false })
    await rm(dir, { recursive: true, force: true })
  })

  test('a capped listing says how to see the rest', async () => {
    const dir = await workspace()

    const result = await Effect.runPromise(call(globTool, { pattern: '**/*', limit: 1 }, dir))

    expect(result?.value).toMatchObject({ truncated: true })
    expect(textOf(result)).toContain('narrow the pattern')
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

  test('binary files and node_modules are not searched', async () => {
    const dir = await workspace()
    await Bun.write(
      join(dir, 'blob.bin'),
      new Uint8Array([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00, 0x01]),
    )
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await Bun.write(join(dir, 'node_modules', 'dep.md'), 'needle from a dependency\n')

    const result = await Effect.runPromise(call(grepTool, { pattern: 'needle' }, dir))

    const value = result?.value as { readonly matches: ReadonlyArray<{ file: string }> }
    expect(value.matches.map((match) => match.file)).toEqual(['a.ts', 'c.md'])
    await rm(dir, { recursive: true, force: true })
  })

  test('a capped search says how to see the rest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fudo-search-'))
    await Bun.write(join(dir, 'many.txt'), 'needle one\nneedle two\nneedle three\n')

    const result = await Effect.runPromise(call(grepTool, { pattern: 'needle', limit: 1 }, dir))

    expect(result?.value).toMatchObject({ truncated: true })
    expect(textOf(result)).toContain('narrow the pattern')
    await rm(dir, { recursive: true, force: true })
  })
})
