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
import { readImageTool } from '../src/index.ts'

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

describe('read_image tool', () => {
  test('returns an image block for a png', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fudo-image-'))
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    await Bun.write(join(dir, 'tiny.png'), bytes)

    const result = await Effect.runPromise(call(readImageTool, { path: 'tiny.png' }, dir))

    expect(result?.isError).toBe(false)
    const block = result?.content[0]
    expect(block?.type).toBe('image')
    expect(block?.type === 'image' ? block.mediaType : '').toBe('image/png')
    expect(block?.type === 'image' ? block.data.length : 0).toBeGreaterThan(0)
    expect(result?.value).toMatchObject({ mediaType: 'image/png', bytes: 8 })
    await rm(dir, { recursive: true, force: true })
  })

  test('refuses a file that is not a known image', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fudo-image-'))
    await Bun.write(join(dir, 'notes.txt'), 'plain')

    const result = await Effect.runPromise(call(readImageTool, { path: 'notes.txt' }, dir))

    expect(result?.isError).toBe(true)
    expect(JSON.stringify(result?.content)).toContain('not a supported image')
    await rm(dir, { recursive: true, force: true })
  })
})
