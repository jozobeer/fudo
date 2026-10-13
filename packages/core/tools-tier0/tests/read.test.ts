import { HooksLive } from '@fudo/kernel'
import { Tools, toolsLayer, type ToolError, type ToolExecutionResult } from '@fudo/tools'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readTool } from '../src/index.ts'

const call = (
  args: unknown,
  cwd: string,
): Effect.Effect<ToolExecutionResult | undefined, ToolError, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(Layer.provideMerge(toolsLayer, HooksLive))
      const tools = Context.get(context, Tools)
      yield* tools.register(readTool)
      return yield* tools.call({
        callId: 'c1',
        tool: 'read',
        arguments: JSON.stringify(args),
        context: { sessionId: 's1', cwd, callId: 'c1' },
      })
    }),
  )

describe('read tool', () => {
  test('returns numbered lines and the total', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fudo-read-'))
    await Bun.write(join(dir, 'a.txt'), 'alpha\nbeta\ngamma\n')

    const result = await Effect.runPromise(call({ path: 'a.txt' }, dir))

    expect(result?.isError).toBe(false)
    expect(result?.content).toEqual([{ type: 'text', text: '1\talpha\n2\tbeta\n3\tgamma' }])
    expect(result?.value).toEqual({ text: '1\talpha\n2\tbeta\n3\tgamma', totalLines: 3 })
    await rm(dir, { recursive: true, force: true })
  })

  test('honours offset and limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fudo-read-'))
    await Bun.write(join(dir, 'b.txt'), 'one\ntwo\nthree\nfour\n')

    const result = await Effect.runPromise(call({ path: 'b.txt', offset: 2, limit: 2 }, dir))

    expect(result?.value).toEqual({ text: '2\ttwo\n3\tthree', totalLines: 4 })
    await rm(dir, { recursive: true, force: true })
  })

  test('a missing file is an error result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fudo-read-'))

    const result = await Effect.runPromise(call({ path: 'nope.txt' }, dir))

    expect(result?.isError).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })
})
