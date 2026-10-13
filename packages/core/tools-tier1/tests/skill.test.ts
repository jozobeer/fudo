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
import { makeSkillTool } from '../src/index.ts'

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
        context: { sessionId: 's1', cwd: '/tmp', callId: 'c1' },
      })
    }),
  )

describe('skill tool', () => {
  test('reads the first matching SKILL.md', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-skill-'))
    await Bun.write(join(root, 'demo', 'SKILL.md'), '# demo\nsteps\n')

    const result = await Effect.runPromise(
      call(makeSkillTool([root, '/missing']), { name: 'demo' }),
    )

    expect(result?.isError).toBe(false)
    expect(result?.value).toEqual({
      name: 'demo',
      path: join(root, 'demo', 'SKILL.md'),
      body: '# demo\nsteps\n',
    })
    await rm(root, { recursive: true, force: true })
  })

  test('refuses a name that could escape the root', async () => {
    const result = await Effect.runPromise(call(makeSkillTool(['/tmp']), { name: '../secrets' }))

    expect(result?.isError).toBe(true)
    expect(JSON.stringify(result?.content)).toContain('lower-case letters')
  })

  test('an unknown skill is an error result', async () => {
    const result = await Effect.runPromise(call(makeSkillTool(['/tmp']), { name: 'nope' }))

    expect(result?.isError).toBe(true)
    expect(JSON.stringify(result?.content)).toContain('unknown skill: nope')
  })
})
