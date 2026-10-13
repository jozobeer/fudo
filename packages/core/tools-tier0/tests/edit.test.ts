import { HooksLive } from '@fudo/kernel'
import { Tools, toolsLayer, type ToolError, type ToolExecutionResult } from '@fudo/tools'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { editTool } from '../src/index.ts'

const call = (
  args: unknown,
  cwd: string,
): Effect.Effect<ToolExecutionResult | undefined, ToolError, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(Layer.provideMerge(toolsLayer, HooksLive))
      const tools = Context.get(context, Tools)
      yield* tools.register(editTool)
      return yield* tools.call({
        callId: 'c1',
        tool: 'edit',
        arguments: JSON.stringify(args),
        context: { sessionId: 's1', cwd, callId: 'c1' },
      })
    }),
  )

const withFile = async (body: string) => {
  const dir = await mkdtemp(join(tmpdir(), 'fudo-edit-'))
  await Bun.write(join(dir, 'a.txt'), body)
  return dir
}

describe('edit tool', () => {
  test('replaces a unique match', async () => {
    const dir = await withFile('one\ntwo\nthree\n')

    const result = await Effect.runPromise(
      call({ path: 'a.txt', oldString: 'two', newString: 'TWO' }, dir),
    )

    expect(result?.isError).toBe(false)
    expect(result?.value).toEqual({ path: join(dir, 'a.txt'), replacements: 1 })
    expect(await Bun.file(join(dir, 'a.txt')).text()).toBe('one\nTWO\nthree\n')
    await rm(dir, { recursive: true, force: true })
  })

  test('refuses text that is missing or ambiguous', async () => {
    const dir = await withFile('a\na\n')

    const missing = await Effect.runPromise(
      call({ path: 'a.txt', oldString: 'zzz', newString: 'x' }, dir),
    )
    const ambiguous = await Effect.runPromise(
      call({ path: 'a.txt', oldString: 'a', newString: 'x' }, dir),
    )

    expect(missing?.isError).toBe(true)
    expect(JSON.stringify(missing?.content)).toContain('no match')
    expect(ambiguous?.isError).toBe(true)
    expect(JSON.stringify(ambiguous?.content)).toContain('2 matches')
    expect(await Bun.file(join(dir, 'a.txt')).text()).toBe('a\na\n')
    await rm(dir, { recursive: true, force: true })
  })

  test('replaces every match when asked', async () => {
    const dir = await withFile('a\na\n')

    const result = await Effect.runPromise(
      call({ path: 'a.txt', oldString: 'a', newString: 'x', all: true }, dir),
    )

    expect(result?.value).toEqual({ path: join(dir, 'a.txt'), replacements: 2 })
    expect(await Bun.file(join(dir, 'a.txt')).text()).toBe('x\nx\n')
    await rm(dir, { recursive: true, force: true })
  })
})
