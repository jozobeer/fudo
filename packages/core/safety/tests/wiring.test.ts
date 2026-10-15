import { HooksLive } from '@jozo-harness/kernel'
import { Tools, toolsLayer, type ToolDefinition } from '@jozo-harness/tools'
import { Effect, Layer, Schema } from 'effect'
import { describe, expect, test } from 'bun:test'

const ok: ToolDefinition<{}, { readonly ok: boolean }> = {
  name: 'ok',
  description: 'Always succeeds',
  parameters: Schema.Struct({}),
  output: {
    schema: Schema.Struct({ ok: Schema.Boolean }),
    render: () => [{ type: 'text', text: 'ran' }],
  },
  execute: () => Effect.succeed({ ok: true }),
}

describe('tools.call wiring', () => {
  test('runs a registered tool when the hooks layer is provided to the tools layer', async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tools = yield* Tools
          yield* tools.register(ok)
          return yield* tools.call({
            callId: 'c1',
            tool: 'ok',
            arguments: '{}',
            context: { sessionId: 's1', cwd: '/work', callId: 'c1' },
          })
        }).pipe(Effect.provide(Layer.provideMerge(toolsLayer, HooksLive))),
      ),
    )

    expect(result.isError).toBe(false)
  })
})
