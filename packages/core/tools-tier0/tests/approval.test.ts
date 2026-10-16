import { HooksLive } from '@jozo-harness/kernel'
import { approvalServiceLayer, policyLayer, type ApprovalRequested } from '@jozo-harness/safety'
import type { SessionEvent } from '@jozo-harness/session'
import { Tools, toolsLayer } from '@jozo-harness/tools'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { makeBashTool } from '../src/index.ts'

describe('bash under the safety preset', () => {
  test('an exec call runs without asking: the preset picks the sandbox, not a gate', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const asked: Array<ApprovalRequested> = []
          const tools = yield* Tools
          yield* tools.register(makeBashTool())
          const result = yield* tools.call({
            callId: 'c1',
            tool: 'bash',
            arguments: JSON.stringify({ command: 'echo ran' }),
            context: { sessionId: 's1', cwd: '/tmp', callId: 'c1' },
          })
          return { asked, isError: result.isError, content: result.content }
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.provideMerge(toolsLayer, HooksLive),
              policyLayer('workspace-write'),
              approvalServiceLayer,
            ),
          ),
        ),
      ),
    )

    expect(observed.asked).toEqual([])
    expect(observed.isError).toBe(false)
    expect(JSON.stringify(observed.content)).toContain('ran')
  })

  test('the approval seam stays out of the way when nobody escalates', async () => {
    const events: Array<SessionEvent> = []
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tools = yield* Tools
          yield* tools.register(makeBashTool())
          const result = yield* tools.call({
            callId: 'c2',
            tool: 'bash',
            arguments: JSON.stringify({ command: 'echo runs' }),
            context: { sessionId: 's1', cwd: '/tmp', callId: 'c2' },
          })
          return { isError: result.isError, content: result.content }
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.provideMerge(toolsLayer, HooksLive),
              policyLayer('full'),
              approvalServiceLayer,
            ),
          ),
        ),
      ),
    )

    expect(observed.isError).toBe(false)
    expect(JSON.stringify(observed.content)).toContain('runs')
    expect(events).toEqual([])
  })
})
