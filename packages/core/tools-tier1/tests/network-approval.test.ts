import { HooksLive } from '@fudo/kernel'
import {
  approvalServiceLayer,
  installApproval,
  policyLayer,
  type ApprovalRequested,
} from '@fudo/safety'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@fudo/session'
import { Tools, toolsLayer } from '@fudo/tools'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { webFetchTool } from '../src/index.ts'

const fakeSession = (events: Array<SessionEvent>): Session =>
  ({
    id: 's1' as SessionId,
    header: { formatVersion: 1, createdAt: 0, cwd: '/tmp' } as SessionHeader,
    events: () => [...events],
    append: (type: string, data: unknown) =>
      Effect.sync(() => {
        events.push({ seq: events.length + 1, time: 0, type, data } as SessionEvent)
      }),
    flush: () => Effect.void,
    derive: () => [],
  }) as unknown as Session

describe('network under a preset', () => {
  test('a fetch is asked about and refused without calling out', async () => {
    let hits = 0
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        hits += 1
        return new Response('secret')
      },
    })
    const url = 'http://127.0.0.1:' + String(server.port) + '/'

    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const events: Array<SessionEvent> = []
          const asked: Array<ApprovalRequested> = []
          const tools = yield* Tools
          yield* tools.register(webFetchTool)
          yield* installApproval(fakeSession(events), (request) =>
            Effect.sync(() => {
              asked.push(request)
              return false
            }),
          )
          const result = yield* tools.call({
            callId: 'c1',
            tool: 'web_fetch',
            arguments: JSON.stringify({ url }),
            context: { sessionId: 's1', cwd: '/tmp', callId: 'c1' },
          })
          return { asked, isError: result.isError, events: events.map((event) => event.type) }
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
    await server.stop(true)

    expect(observed.asked.map((request) => request.reason)).toEqual([
      'preset workspace-write does not allow: network',
    ])
    expect(observed.isError).toBe(true)
    expect(hits).toBe(0)
    expect(observed.events).toEqual(['safety/approval/requested', 'safety/approval/answered'])
  })
})
