import { describe, expect, test } from 'vitest'
import { kernelPlugin, loadProfile, type Plugin } from '@jozo-harness/kernel'
import {
  SessionError,
  SessionPersistenceService,
  Sessions,
  sessionPlugin,
  type OpenedSession,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
  type SessionPersistence,
  type SessionSink,
  type SessionSummary,
} from '@jozo-harness/session'
import { Context, Effect, Layer, Schema } from 'effect'
import { AgentRunnerService, Agents, agentPlugin, type AgentRunner } from '../src/index.ts'

const stubPersistence = (): SessionPersistence => {
  const stored = new Map<SessionId, { events: Array<SessionEvent> }>()
  const opened = (id: SessionId): OpenedSession => {
    const record = stored.get(id)
    if (record === undefined) throw new Error('missing session')
    const sink: SessionSink = {
      append: (event) =>
        Effect.sync(() => {
          record.events.push(event)
        }),
      flush: () => Effect.void,
    }
    return { id, events: [...record.events], sink }
  }
  return {
    create: (header: SessionHeader) =>
      Effect.sync(() => {
        const id = crypto.randomUUID()
        stored.set(id, {
          events: [{ seq: 1, time: header.createdAt, type: 'session/header', data: header }],
        })
        return opened(id)
      }),
    open: (id) => Effect.succeed(opened(id)),
    stat: (id) => Effect.fail(new SessionError({ code: 'not-found', message: `no summary ${id}` })),
    list: () => Effect.succeed<ReadonlyArray<SessionSummary>>([]),
  }
}

const providerPlugin: Plugin<{}, SessionPersistenceService, never> = {
  name: 'provider',
  config: Schema.Struct({}),
  provides: [SessionPersistenceService],
  requires: [],
  layer: () => Layer.succeed(SessionPersistenceService, stubPersistence()),
}

const runnerPlugin: Plugin<{}, AgentRunnerService, never> = {
  name: 'runner',
  config: Schema.Struct({}),
  provides: [AgentRunnerService],
  requires: [],
  layer: () =>
    Layer.succeed(AgentRunnerService, {
      run: () => Effect.void,
    } satisfies AgentRunner),
}

describe('agentPlugin', () => {
  test('assembles through the loader and lists a created agent', async () => {
    const listed = await Effect.runPromise(
      Effect.gen(function* () {
        const layer = yield* loadProfile({
          plugins: [kernelPlugin, providerPlugin, sessionPlugin, runnerPlugin, agentPlugin],
          layers: [
            [
              { id: 'kernel', name: '@jozo-harness/kernel', config: {} },
              { id: 'provider', name: 'provider', config: {} },
              { id: 'sessions', name: '@jozo-harness/session', config: {} },
              { id: 'runner', name: 'runner', config: {} },
              { id: 'agent', name: '@jozo-harness/agent', config: {} },
            ],
          ],
        })
        const context = yield* Layer.build(layer)
        const agents = Context.get(context, Agents)
        const agent = yield* agents.create({ cwd: '/work', options: { route: 'fake/model' } })
        return {
          count: agents.list().length,
          status: agent.status,
          sessions: Context.get(context, Sessions) !== undefined,
        }
      }).pipe(Effect.scoped),
    )

    expect(listed).toEqual({ count: 1, status: 'idle', sessions: true })
  })
})
