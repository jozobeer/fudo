import { HooksLive } from '@jozo-harness/kernel'
import {
  Tools,
  toolsLayer,
  type ToolDefinition,
  type ToolError,
  type ToolExecutionResult,
} from '@jozo-harness/tools'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeEditTool, makeObservedFiles, makeReadTool, makeWriteTool } from '../src/index.ts'

/** One session's tools share what they have observed about the workspace. */
const makeSession = (cwd: string) => {
  const observed = makeObservedFiles()
  const list: ReadonlyArray<ToolDefinition<any, any>> = [
    makeReadTool(observed),
    makeWriteTool(observed),
    makeEditTool(observed),
  ]
  return (
    name: string,
    args: unknown,
  ): Effect.Effect<ToolExecutionResult | undefined, ToolError, never> =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(Layer.provideMerge(toolsLayer, HooksLive))
        const tools = Context.get(context, Tools)
        for (const tool of list) yield* tools.register(tool)
        return yield* tools.call({
          callId: 'c1',
          tool: name,
          arguments: JSON.stringify(args),
          context: { sessionId: 's1', cwd, callId: 'c1' },
        })
      }),
    )
}

describe('write tool', () => {
  test('creates parent directories and reports the size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jozo-harness-write-'))
    const call = makeSession(dir)

    const result = await Effect.runPromise(call('write', { path: 'a/b.txt', content: 'hi\nthere' }))

    expect(result?.isError).toBe(false)
    expect(result?.value).toEqual({ path: join(dir, 'a', 'b.txt'), bytes: 8 })
    expect(await Bun.file(join(dir, 'a', 'b.txt')).text()).toBe('hi\nthere')
    await rm(dir, { recursive: true, force: true })
  })

  test('refuses a path outside the workspace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jozo-harness-write-'))
    const call = makeSession(dir)

    const result = await Effect.runPromise(call('write', { path: '../escape.txt', content: 'x' }))

    expect(result?.isError).toBe(true)
    expect(JSON.stringify(result?.content)).toContain('escapes the workspace')
    await rm(dir, { recursive: true, force: true })
  })

  test('refuses to overwrite a file this session never read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jozo-harness-write-'))
    await Bun.write(join(dir, 'notes.txt'), 'the original\n')
    const call = makeSession(dir)

    const result = await Effect.runPromise(
      call('write', { path: 'notes.txt', content: 'clobbered\n' }),
    )

    expect(result?.isError).toBe(true)
    expect(JSON.stringify(result?.content)).toContain('read')
    expect(await Bun.file(join(dir, 'notes.txt')).text()).toBe('the original\n')
    await rm(dir, { recursive: true, force: true })
  })

  test('overwrites a file that was read and has not changed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jozo-harness-write-'))
    await Bun.write(join(dir, 'notes.txt'), 'the original\n')
    const call = makeSession(dir)

    await Effect.runPromise(call('read', { path: 'notes.txt' }))
    const result = await Effect.runPromise(
      call('write', { path: 'notes.txt', content: 'replaced\n' }),
    )

    expect(result?.isError).toBe(false)
    expect(await Bun.file(join(dir, 'notes.txt')).text()).toBe('replaced\n')
    await rm(dir, { recursive: true, force: true })
  })

  test('refuses a file that changed after it was read, and leaves it alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jozo-harness-write-'))
    await Bun.write(join(dir, 'notes.txt'), 'the original\n')
    const call = makeSession(dir)

    await Effect.runPromise(call('read', { path: 'notes.txt' }))
    await Bun.write(join(dir, 'notes.txt'), 'someone else wrote this\n')
    const result = await Effect.runPromise(
      call('write', { path: 'notes.txt', content: 'clobbered\n' }),
    )

    expect(result?.isError).toBe(true)
    expect(JSON.stringify(result?.content)).toContain('changed')
    expect(await Bun.file(join(dir, 'notes.txt')).text()).toBe('someone else wrote this\n')
    await rm(dir, { recursive: true, force: true })
  })

  test('writes CRLF as LF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jozo-harness-write-'))
    const call = makeSession(dir)

    await Effect.runPromise(call('write', { path: 'crlf.txt', content: 'one\r\ntwo\r\n' }))

    expect(await Bun.file(join(dir, 'crlf.txt')).text()).toBe('one\ntwo\n')
    await rm(dir, { recursive: true, force: true })
  })
})
