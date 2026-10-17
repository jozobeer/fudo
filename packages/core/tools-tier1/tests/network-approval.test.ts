import { HooksLive } from '@jozo-harness/kernel'
import { approvalServiceLayer, policyLayer, type ApprovalRequested } from '@jozo-harness/safety'
import { Tools, toolsLayer } from '@jozo-harness/tools'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { startStubServer } from '@jozo-harness/test-support-stub'
import { webFetchTool } from '../src/index.ts'

describe('network under a preset', () => {
  test('a fetch runs without being asked about: the sandbox bounds files, not the network', async () => {
    let hits = 0
    const server = await startStubServer(() => {
      hits += 1
      return new Response('secret')
    })
    const url = server.origin + '/'

    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const asked: Array<ApprovalRequested> = []
          const tools = yield* Tools
          yield* tools.register(webFetchTool)
          const result = yield* tools.call({
            callId: 'c1',
            tool: 'web_fetch',
            arguments: JSON.stringify({ url }),
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
    await server.stop()

    expect(observed.asked).toEqual([])
    expect(observed.isError).toBe(false)
    expect(JSON.stringify(observed.content)).toContain('secret')
    expect(hits).toBe(1)
  })
})
