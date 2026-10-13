import { HooksLive } from '@fudo/kernel'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@fudo/session'
import { Tools, toolsLayer, type ToolDefinition } from '@fudo/tools'
import { Deferred, Effect, Layer, Schema } from 'effect'
import { describe, expect, test } from 'bun:test'
import { Approval, approvalServiceLayer, installApproval, policyLayer } from '../src/index.ts'

const fakeSession = (events: Array<SessionEvent>): Session =>
  ({
    id: 's1' as SessionId,
    header: { formatVersion: 1, createdAt: 0, cwd: '/work' } as SessionHeader,
    events: () => [...events],
    append: (type: string, data: unknown) =>
      Effect.sync(() => {
        events.push({ seq: events.length + 1, time: 0, type, data } as SessionEvent)
      }),
    flush: () => Effect.void,
    derive: () => [],
  }) as unknown as Session

const danger: ToolDefinition<{}, { readonly ok: boolean }> = {
  name: 'danger',
  description: 'Needs to run a command',
  parameters: Schema.Struct({}),
  needs: ['exec'],
  output: {
    schema: Schema.Struct({ ok: Schema.Boolean }),
    render: () => [{ type: 'text', text: 'ran' }],
  },
  execute: () => Effect.succeed({ ok: true }),
}

const layerFor = (policy: 'read-only' | 'full') =>
  Layer.mergeAll(
    Layer.provideMerge(toolsLayer, HooksLive),
    policyLayer(policy),
    approvalServiceLayer,
  )

const run = (policy: 'read-only' | 'full') =>
  Effect.scoped(
    Effect.gen(function* () {
      const events: Array<SessionEvent> = []
      const session = fakeSession(events)
      const tools = yield* Tools
      yield* tools.register(danger)
      yield* installApproval(session)
      const approval = yield* Approval
      const done = yield* Deferred.make<boolean>()
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          const result = yield* tools.call({
            callId: 'c1',
            tool: 'danger',
            arguments: '{}',
            context: { sessionId: 's1', cwd: '/work', callId: 'c1' },
          })
          yield* Deferred.succeed(done, result.isError)
        }),
      )
      yield* Effect.sleep('10 millis')
      const waiting = events.map((event) => event.type)
      yield* approval.answer('c1', false)
      const isError = yield* Deferred.await(done)
      return { waiting, isError, types: events.map((event) => event.type) }
    }).pipe(Effect.provide(layerFor(policy))),
  )

describe('installApproval', () => {
  test('asks before a call outside the preset and denies on refusal', async () => {
    const observed = await Effect.runPromise(run('read-only'))

    expect(observed.waiting).toEqual(['safety/approval/requested'])
    expect(observed.isError).toBe(true)
    expect(observed.types).toEqual(['safety/approval/requested', 'safety/approval/answered'])
  })

  test('runs without asking when the preset covers the call', async () => {
    const observed = await Effect.runPromise(run('full'))

    expect(observed.waiting).toEqual([])
    expect(observed.isError).toBe(false)
  })
})
