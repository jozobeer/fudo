import { HooksLive } from '@fudo/kernel'
import { Tools, toolsLayer, type ToolDefinition } from '@fudo/tools'
import { Context, Effect, Layer, Schema } from 'effect'
import { describe, expect, test } from 'bun:test'
import { installPlanMode, PLAN_MODE_TOOLS, planModeRestriction } from '../src/index.ts'

const tool = (name: string): ToolDefinition<{}, { readonly ok: boolean }> => ({
  name,
  description: 'Does nothing',
  parameters: Schema.Struct({}),
  output: {
    schema: Schema.Struct({ ok: Schema.Boolean }),
    render: () => [{ type: 'text', text: 'ok' }],
  },
  execute: () => Effect.succeed({ ok: true }),
})

const build = (install: boolean) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(Layer.provideMerge(toolsLayer, HooksLive))
      const tools = Context.get(context, Tools)
      for (const name of ['read', 'write', 'bash', 'todo_write']) yield* tools.register(tool(name))
      if (install) yield* installPlanMode(tools)
      const visible = tools.schemas().map((schema) => schema.name)
      const write = yield* tools.call({
        callId: 'c1',
        tool: 'write',
        arguments: '{}',
        context: { sessionId: 's1', cwd: '/tmp', callId: 'c1' },
      })
      return { visible, writeError: write.isError }
    }),
  )

describe('plan mode', () => {
  test('hides the tools that could change the workspace', async () => {
    const observed = await Effect.runPromise(build(true))

    expect(observed.visible).toEqual(['read', 'todo_write'])
    expect(observed.writeError).toBe(true)
  })

  test('without the restriction everything stays visible', async () => {
    const observed = await Effect.runPromise(build(false))

    expect(observed.visible).toEqual(['read', 'write', 'bash', 'todo_write'])
    expect(observed.writeError).toBe(false)
  })

  test('the allowed list is the read-only set', () => {
    expect(planModeRestriction().allows('read')).toBe(true)
    expect(planModeRestriction().allows('bash')).toBe(false)
    expect(PLAN_MODE_TOOLS).not.toContain('write')
  })
})
