import { HooksLive } from '@jozo-harness/kernel'
import {
  approvalServiceLayer,
  installApproval,
  policyLayer,
  type ApprovalRequested,
} from '@jozo-harness/safety'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@jozo-harness/session'
import { Tools, toolsLayer } from '@jozo-harness/tools'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { makeBashTool } from '../src/index.ts'

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

describe('bash under the safety preset', () => {
  test('an exec call is asked about and refused when the user says no', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const events: Array<SessionEvent> = []
          const asked: Array<ApprovalRequested> = []
          const session = fakeSession(events)
          const tools = yield* Tools
          yield* tools.register(makeBashTool())
          yield* installApproval(session, (request) =>
            Effect.sync(() => {
              asked.push(request)
              return false
            }),
          )
          const result = yield* tools.call({
            callId: 'c1',
            tool: 'bash',
            arguments: JSON.stringify({ command: 'echo should-not-run' }),
            context: { sessionId: 's1', cwd: '/tmp', callId: 'c1' },
          })
          return { asked, isError: result.isError, content: result.content, events }
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

    expect(observed.asked).toHaveLength(1)
    expect(observed.asked[0]?.tool).toBe('bash')
    expect(observed.asked[0]?.reason).toBe('preset workspace-write does not allow: exec')
    expect(observed.isError).toBe(true)
    expect(JSON.stringify(observed.content)).not.toContain('should-not-run')
    expect(observed.events.map((event) => event.type)).toEqual([
      'safety/approval/requested',
      'safety/approval/answered',
    ])
  })

  test('the full preset runs the same call without asking', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const events: Array<SessionEvent> = []
          const session = fakeSession(events)
          const tools = yield* Tools
          yield* tools.register(makeBashTool())
          yield* installApproval(session)
          const result = yield* tools.call({
            callId: 'c2',
            tool: 'bash',
            arguments: JSON.stringify({ command: 'echo runs' }),
            context: { sessionId: 's1', cwd: '/tmp', callId: 'c2' },
          })
          return { isError: result.isError, content: result.content, events }
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
    expect(observed.events).toEqual([])
  })
})
