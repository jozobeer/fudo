import { describe, expect, test } from 'bun:test'
import { Agents, agentsLayer, type Agent, type AgentError, type AgentsShape } from '@fudo/agent'
import { Hooks, makeHooks, type HookRegistry } from '@fudo/kernel'
import { Llm, LlmFailure, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import {
  SessionError,
  sessionsLayer,
  type OpenedSession,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
  type SessionPersistence,
  type SessionSink,
  type SessionSummary,
} from '@fudo/session'
import { SystemPrompt, makeSystemPrompt, type SystemPromptShape } from '@fudo/system-prompt'
import { Tools, ToolError, makeTools, type ToolDefinition, type ToolRegistry } from '@fudo/tools'
import { Effect, Layer, Schema, Scope, Stream } from 'effect'
import { AgentLoop, agentLoopLayer } from '../src/index.ts'

type Script = () => Stream.Stream<StreamChunk, LlmFailure>

const chunks =
  (list: ReadonlyArray<StreamChunk>): Script =>
  () =>
    Stream.fromIterable(list)
const fails =
  (failure: LlmFailure): Script =>
  () =>
    Stream.fail(failure)
const forever =
  (list: ReadonlyArray<StreamChunk>): Script =>
  () =>
    Stream.concat(Stream.fromIterable(list), Stream.never)

const adapter = (scripts: ReadonlyArray<Script>): LlmAdapter => {
  let call = 0
  return {
    name: 'fake',
    capabilities: {
      toolChoice: false,
      reasoningEffort: null,
      images: 'none',
      promptCacheControl: false,
    },
    stream: () => {
      const script = scripts[call] ?? chunks([])
      call += 1
      return script()
    },
  }
}

const sessionPersistence = (): SessionPersistence => {
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
    open: (id) =>
      stored.has(id)
        ? Effect.sync(() => opened(id))
        : Effect.fail(new SessionError({ code: 'not-found', message: 'no session' })),
    stat: (id) => Effect.fail(new SessionError({ code: 'not-found', message: `no summary ${id}` })),
    list: () => Effect.succeed<ReadonlyArray<SessionSummary>>([]),
  }
}

interface Ctx {
  readonly agents: AgentsShape
  readonly hooks: HookRegistry
  readonly tools: ToolRegistry
  readonly prompt: SystemPromptShape
}

const scenario = <A>(
  scripts: ReadonlyArray<Script>,
  body: (ctx: Ctx) => Effect.Effect<A, AgentError | ToolError, Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const hooks = makeHooks()
      const tools = makeTools(hooks)
      const prompt = makeSystemPrompt()
      const services = Layer.mergeAll(
        Layer.succeed(Hooks, hooks),
        Layer.succeed(Tools, tools),
        Layer.succeed(SystemPrompt, prompt),
        Layer.succeed(Llm, adapter(scripts)),
      )
      const runner = yield* AgentLoop.pipe(Effect.provide(Layer.provide(agentLoopLayer, services)))
      const app = Layer.provideMerge(
        Layer.provide(agentsLayer(runner), sessionsLayer(sessionPersistence(), { now: () => 1 })),
        Layer.succeed(Hooks, hooks),
      )
      return yield* Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            const agents = yield* Agents
            return yield* Effect.orDie(body({ agents, hooks, tools, prompt }))
          }),
        ),
        app,
      )
    }),
  )

const types = (agent: Agent) => agent.session.events().map((event) => event.type)
const reason = (agent: Agent) =>
  agent.session.events().flatMap((event) => (event.type === 'turn/end' ? [event.data.reason] : []))

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } },
  { type: 'finish', kind: 'stop' },
]

describe('agent loop', () => {
  test('runs one completed turn and records the request series in order', async () => {
    const text = crypto.randomUUID()
    const events = await scenario([chunks(textTurn(text))], (ctx) =>
      Effect.gen(function* () {
        const agent = yield* ctx.agents.create({ cwd: '/work', options: { route: 'fake/model' } })
        yield* agent.followup({ text: 'hello', source: 'user' })
        yield* agent.whenIdle
        return agent
      }),
    )

    expect(types(events)).toEqual([
      'session/header',
      'agent/inbox/queued',
      'turn/start',
      'agent/inbox/claimed',
      'step/start',
      'system/message',
      'user/message',
      'request/header',
      'assistant/message',
      'step/end',
      'turn/end',
    ])
    expect(reason(events)).toEqual([{ kind: 'completed' }])
    const assistant = events.session
      .events()
      .flatMap((event) => (event.type === 'assistant/message' ? [event.data.content] : []))
    expect(assistant).toEqual([[{ type: 'text', text }]])
  })

  test('executes a tool call and runs a second step with its result', async () => {
    const echo: ToolDefinition<{ readonly text: string }, { readonly text: string }> = {
      name: 'echo',
      description: 'Echo',
      parameters: Schema.Struct({ text: Schema.String }),
      output: {
        schema: Schema.Struct({ text: Schema.String }),
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: (args) => Effect.succeed({ text: args.text }),
    }
    const events = await scenario(
      [
        chunks([
          {
            type: 'block-end',
            index: 0,
            block: { type: 'tool-call', id: 'c1', name: 'echo', arguments: '{"text":"x"}' },
          },
          { type: 'finish', kind: 'tool-calls' },
        ]),
        chunks(textTurn('done')),
      ],
      (ctx) =>
        Effect.gen(function* () {
          yield* ctx.tools.register(echo)
          const agent = yield* ctx.agents.create({ cwd: '/work', options: { route: 'fake/model' } })
          yield* agent.followup({ text: 'go', source: 'user' })
          yield* agent.whenIdle
          return agent
        }),
    )

    const eventTypes = types(events)
    expect(eventTypes.filter((type) => type === 'step/start')).toHaveLength(2)
    expect(eventTypes).toContain('tool/call')
    expect(eventTypes).toContain('tool/result')
    expect(eventTypes.indexOf('tool/call')).toBeLessThan(eventTypes.indexOf('tool/result'))
    expect(reason(events)).toEqual([{ kind: 'completed' }])
  })

  test('input queued while a tool runs joins the next step', async () => {
    const note = crypto.randomUUID()
    const events = await scenario(
      [
        chunks([
          {
            type: 'block-end',
            index: 0,
            block: { type: 'tool-call', id: 'c1', name: 'poke', arguments: '{}' },
          },
          { type: 'finish', kind: 'tool-calls' },
        ]),
        chunks(textTurn('done')),
      ],
      (ctx) =>
        Effect.gen(function* () {
          const agent = yield* ctx.agents.create({ cwd: '/work', options: { route: 'fake/model' } })
          const poke: ToolDefinition<{}, { readonly ok: boolean }> = {
            name: 'poke',
            description: 'Queues one note while it runs',
            parameters: Schema.Struct({}),
            output: {
              schema: Schema.Struct({ ok: Schema.Boolean }),
              render: () => [{ type: 'text', text: 'poked' }],
            },
            execute: () =>
              agent.inject({ text: note, source: 'inject' }).pipe(
                Effect.mapError(
                  () => new ToolError({ code: 'execution', message: 'cannot queue the note' }),
                ),
                Effect.as({ ok: true }),
              ),
          }
          yield* ctx.tools.register(poke)
          yield* agent.followup({ text: 'go', source: 'user' })
          yield* agent.whenIdle
          return agent
        }),
    )

    const kinds = types(events)
    const stored = events.session.events()
    const result = kinds.indexOf('tool/result')
    const injected = stored.findIndex(
      (event) => event.type === 'user/message' && event.data.source === 'inject',
    )
    const request = kinds.indexOf('request/header', result)

    expect(kinds.filter((type) => type === 'step/start')).toHaveLength(2)
    expect(injected).toBeGreaterThan(result)
    expect(injected).toBeLessThan(request)
    expect(stored[injected]?.type === 'user/message' ? stored[injected].data.text : '').toBe(note)
  })

  test('retries a failed attempt without repeating the request header', async () => {
    const text = crypto.randomUUID()
    const events = await scenario(
      [fails(new LlmFailure({ code: 'TIMEOUT', message: 'slow' })), chunks(textTurn(text))],
      (ctx) =>
        Effect.gen(function* () {
          yield* ctx.hooks.on('agent/request-error', () =>
            Effect.succeed({ kind: 'retry' as const }),
          )
          const agent = yield* ctx.agents.create({ cwd: '/work', options: { route: 'fake/model' } })
          yield* agent.followup({ text: 'go', source: 'user' })
          yield* agent.whenIdle
          return agent
        }),
    )

    const eventTypes = types(events)
    expect(eventTypes.filter((type) => type === 'assistant/attempt')).toHaveLength(1)
    expect(eventTypes.filter((type) => type === 'assistant/message')).toHaveLength(1)
    expect(eventTypes.filter((type) => type === 'request/header')).toHaveLength(1)
    expect(reason(events)).toEqual([{ kind: 'completed' }])
  })

  test('cancel records a cancelled turn end', async () => {
    const events = await scenario(
      [forever([{ type: 'block-start', index: 0, blockType: 'text' }])],
      (ctx) =>
        Effect.gen(function* () {
          const agent = yield* ctx.agents.create({ cwd: '/work', options: { route: 'fake/model' } })
          yield* agent.followup({ text: 'go', source: 'user' })
          for (let index = 0; index < 50 && agent.status !== 'running'; index += 1)
            yield* Effect.yieldNow
          expect(agent.status).toBe('running')
          yield* agent.cancel('user')
          yield* agent.whenIdle
          return agent
        }),
    )

    expect(reason(events)).toEqual([{ kind: 'cancelled', cause: 'user' }])
  })

  test('cancel during a tool call pairs the call with a synthesized result', async () => {
    const slow: ToolDefinition<{}, { readonly ok: boolean }> = {
      name: 'slow',
      description: 'Never finishes',
      parameters: Schema.Struct({}),
      output: {
        schema: Schema.Struct({ ok: Schema.Boolean }),
        render: () => [{ type: 'text', text: 'ok' }],
      },
      execute: () => Effect.sleep('1 hour').pipe(Effect.as({ ok: true })),
    }

    const events = await scenario(
      [
        chunks([
          {
            type: 'block-end',
            index: 0,
            block: { type: 'tool-call', id: 'c1', name: 'slow', arguments: '{}' },
          },
          { type: 'finish', kind: 'tool-calls' },
        ]),
        chunks(textTurn('done')),
      ],
      (ctx) =>
        Effect.gen(function* () {
          yield* ctx.tools.register(slow)
          const agent = yield* ctx.agents.create({ cwd: '/work', options: { route: 'fake/model' } })
          yield* agent.followup({ text: 'go', source: 'user' })
          for (let index = 0; index < 200; index += 1) {
            if (agent.session.events().some((event) => event.type === 'tool/call')) break
            yield* Effect.yieldNow
          }
          yield* agent.cancel('user')
          yield* agent.whenIdle
          return agent
        }),
    )

    const kinds = types(events)
    const callIndex = kinds.indexOf('tool/call')
    const resultIndex = kinds.indexOf('tool/result')
    const result = events.session.events().find((event) => event.type === 'tool/result')

    expect(callIndex).toBeGreaterThanOrEqual(0)
    expect(resultIndex).toBeGreaterThan(callIndex)
    expect(result?.data.isError).toBe(true)
    expect(reason(events)).toEqual([{ kind: 'cancelled', cause: 'user' }])
  })
})
