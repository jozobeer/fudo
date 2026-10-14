import { HooksLive } from '@fudo/kernel'
import { Tools, toolsLayer, type ToolDefinition } from '@fudo/tools'
import { Context, Effect, Layer, Schema } from 'effect'
import { describe, expect, test } from 'bun:test'
import { makePlanMode, PLAN_MODE_TOOLS, planModeRestriction } from '../src/index.ts'

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

/** Builds a workspace with the restriction installed, and a way to lift it. */
const build = (install: boolean) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(Layer.provideMerge(toolsLayer, HooksLive))
      const tools = Context.get(context, Tools)
      const planMode = makePlanMode()
      for (const name of ['read', 'write', 'bash', 'todo_write', 'exit_plan_mode']) {
        yield* tools.register(tool(name))
      }
      if (install) yield* planMode.install(tools)
      const before = tools.schemas().map((schema) => schema.name)
      const hiddenWrite = yield* tools.call({
        callId: 'c1',
        tool: 'write',
        arguments: '{}',
        context: { sessionId: 's1', cwd: '/tmp', callId: 'c1' },
      })
      planMode.leave()
      const after = tools.schemas().map((schema) => schema.name)
      const allowedWrite = yield* tools.call({
        callId: 'c2',
        tool: 'write',
        arguments: '{}',
        context: { sessionId: 's1', cwd: '/tmp', callId: 'c2' },
      })
      return {
        before,
        hiddenWrite: hiddenWrite.isError,
        after,
        allowedWrite: allowedWrite.isError,
        active: planMode.active(),
      }
    }),
  )

describe('plan mode', () => {
  test('hides the tools that could change the workspace', async () => {
    const observed = await Effect.runPromise(build(true))

    expect(observed.before).toEqual(['read', 'todo_write', 'exit_plan_mode'])
    expect(observed.hiddenWrite).toBe(true)
  })

  test('without the restriction everything stays visible', async () => {
    const observed = await Effect.runPromise(build(false))

    expect(observed.before).toEqual(['read', 'write', 'bash', 'todo_write', 'exit_plan_mode'])
    expect(observed.hiddenWrite).toBe(false)
  })

  test('leaving plan mode brings the hidden tools back from the next call on', async () => {
    const observed = await Effect.runPromise(build(true))

    expect(observed.after).toContain('write')
    expect(observed.allowedWrite).toBe(false)
    expect(observed.active).toBe(false)
  })

  test('the allowed list is the read-only set plus the way out', () => {
    const planMode = makePlanMode()

    expect(planModeRestriction(planMode.active).allows('read')).toBe(true)
    expect(planModeRestriction(planMode.active).allows('bash')).toBe(false)
    expect(PLAN_MODE_TOOLS).not.toContain('write')
    expect(PLAN_MODE_TOOLS).toContain('exit_plan_mode')
  })
})
