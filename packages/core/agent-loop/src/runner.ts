import { AgentRunnerService, type Agent, type AgentRunner, type UserMessage } from '@fudo/agent'
import { Hooks, type Plugin } from '@fudo/kernel'
import {
  BlockAssembler,
  Llm,
  LlmFailure,
  compactAssistantStream,
  encodeLlmFailure,
  type ContentBlock,
  type StreamChunk,
  type TimedStreamChunk,
} from '@fudo/llm'
import {
  compactMessages,
  cwdOf,
  deriveMessages,
  type CompactOptions,
  type Session,
  type SessionEventMap,
} from '@fudo/session'
import { SystemPrompt } from '@fudo/system-prompt'
import { applySpill, type SpillOptions } from '@fudo/tools'
import { Tools } from '@fudo/tools'
import { Context, Effect, Exit, Layer, Queue, Schema, Stream } from 'effect'
import { tmpdir } from 'node:os'
import { groupCalls } from './batch.ts'
import type { AgentRequest } from './hooks.ts'

export class AgentLoop extends Context.Service<AgentLoop, AgentRunner>()('fudo/AgentLoop') {}

type ToolCall = Extract<ContentBlock, { type: 'tool-call' }>

type StepOutcome =
  | { readonly ok: true; readonly content: ReadonlyArray<ContentBlock> }
  | { readonly ok: false; readonly failure: LlmFailure }

/** The newest messages stay intact; older output is shortened before every request. */
const COMPACT_MESSAGES: CompactOptions = { keepLast: 12, maxBytes: 32_000 }

/** Results larger than this are written to a file; only their head stays in the log. */
const SPILL_BYTES = 32_000

const SPILL: SpillOptions = {
  maxSpillBytes: SPILL_BYTES,
  spill: (callId, text) =>
    Effect.promise(async () => {
      const path = tmpdir() + '/fudo-spill/' + callId + '.txt'
      await Bun.write(path, text)
      return path
    }),
}

const isToolCall = (block: ContentBlock): block is ToolCall => block.type === 'tool-call'

const splitRoute = (route: string): { readonly provider: string; readonly model: string } => {
  const index = route.indexOf('/')
  return index < 0
    ? { provider: route, model: '' }
    : { provider: route.slice(0, index), model: route.slice(index + 1) }
}

const countEvents = (session: Session, type: 'turn/start' | 'step/start'): number =>
  session.events().filter((event) => event.type === type).length

const recordedTurnEnd = (session: Session, turn: number): boolean =>
  session.events().some((event) => event.type === 'turn/end' && event.data.turn === turn)

const agentLoopEffect: Effect.Effect<AgentRunner, never, Hooks | Tools | SystemPrompt | Llm> =
  Effect.gen(function* () {
    const hooks = yield* Hooks
    const tools = yield* Tools
    const promptService = yield* SystemPrompt
    const llm = yield* Llm

    // A session that cannot be written stops the agent: `orDie` turns the failure into
    // a defect, which `runTurn` records as an error turn and which kills the runner.
    const append = <K extends keyof SessionEventMap>(
      agent: Agent,
      type: K,
      data: SessionEventMap[K],
    ): Effect.Effect<void> => agent.session.append(type, data).pipe(Effect.orDie)

    const recordAttempt = (
      agent: Agent,
      request: AgentRequest,
      failure: LlmFailure,
      stream: ReadonlyArray<TimedStreamChunk>,
    ): Effect.Effect<void> =>
      append(agent, 'assistant/attempt', {
        provider: request.provider,
        model: request.model,
        failure: encodeLlmFailure(failure),
        stream: compactAssistantStream(stream),
      })

    const streamStep = (agent: Agent, request: AgentRequest): Effect.Effect<StepOutcome> =>
      Effect.gen(function* () {
        const assembler = new BlockAssembler()
        const stream: Array<TimedStreamChunk> = []
        const collect = (chunk: StreamChunk) =>
          Effect.gen(function* () {
            const timed: TimedStreamChunk = { time: Date.now(), chunk }
            stream.push(timed)
            assembler.push(chunk)
            yield* hooks.emit('agent/assistant-stream', timed)
          })

        return yield* Stream.runForEach(llm.stream(request), collect).pipe(
          Effect.matchEffect({
            onFailure: (failure: LlmFailure) =>
              Effect.gen(function* () {
                yield* recordAttempt(agent, request, failure, stream)
                return { ok: false as const, failure }
              }),
            onSuccess: () =>
              Effect.gen(function* () {
                const assembled = assembler.snapshot()
                if (assembled.content.length === 0 || assembled.finish === 'error') {
                  const failure = new LlmFailure({
                    code: assembled.content.length === 0 ? 'EMPTY_RESPONSE' : 'PROVIDER',
                    message: 'the provider completed without usable content',
                  })
                  yield* recordAttempt(agent, request, failure, stream)
                  return { ok: false as const, failure }
                }
                yield* append(agent, 'assistant/message', {
                  provider: request.provider,
                  model: request.model,
                  content: assembled.content,
                  ...(assembled.usage === undefined ? {} : { usage: assembled.usage }),
                  stream: compactAssistantStream(stream),
                })
                return { ok: true as const, content: assembled.content }
              }),
          }),
        )
      })

    const requestStep = (
      agent: Agent,
      input: ReadonlyArray<UserMessage>,
    ): Effect.Effect<StepOutcome> =>
      Effect.gen(function* () {
        const build = yield* promptService
          .build({ variables: {} })
          .pipe(Effect.provideService(Tools, tools), Effect.orDie)
        if (input.length > 0) {
          yield* append(agent, 'system/message', { text: build.system })
          for (const message of input) {
            yield* append(agent, 'user/message', { text: message.text, source: message.source })
          }
        }
        const route = splitRoute(agent.options.route)
        const base: AgentRequest = {
          provider: route.provider,
          model: route.model,
          params:
            agent.options.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: agent.options.reasoningEffort },
          messages: compactMessages(deriveMessages(agent.session.events()), COMPACT_MESSAGES)
            .messages,
          tools: build.tools,
        }
        const request = (yield* hooks.waterfall('agent/request', base)) ?? base
        yield* append(agent, 'request/header', {
          provider: request.provider,
          model: request.model,
          params: request.params,
        })

        while (true) {
          const outcome = yield* streamStep(agent, request)
          if (outcome.ok) return outcome
          const decision = yield* hooks.waterfall('agent/request-error', outcome.failure)
          if (decision?.kind !== 'retry') return outcome
          // A retry resends the settled request; assembly and request/header do not repeat.
        }
      })

    const executeCalls = (agent: Agent, calls: ReadonlyArray<ToolCall>): Effect.Effect<void> =>
      Effect.gen(function* () {
        const pending = new Map<string, ToolCall>()
        yield* Effect.onExit(
          Effect.gen(function* () {
            const runOne = (call: ToolCall) =>
              Effect.gen(function* () {
                const outcome = yield* tools.call({
                  callId: call.id,
                  tool: call.name,
                  arguments: call.arguments,
                  context: {
                    sessionId: agent.id,
                    cwd: cwdOf(agent.session.events(), agent.session.header),
                    callId: call.id,
                  },
                })
                const shown = yield* applySpill(outcome, call.id, SPILL)
                yield* append(agent, 'tool/result', {
                  callId: call.id,
                  isError: shown.isError,
                  content: shown.content,
                })
                pending.delete(call.id)
              })

            const batches = groupCalls(calls, (call) =>
              tools.isConcurrencySafe(call.name, call.arguments),
            )
            for (const batch of batches) {
              for (const call of batch.calls) {
                yield* append(agent, 'tool/call', {
                  callId: call.id,
                  name: call.name,
                  arguments: call.arguments,
                })
                pending.set(call.id, call)
              }
              if (batch.parallel) {
                yield* Effect.forEach(batch.calls, runOne, { concurrency: 'unbounded' })
              } else {
                for (const call of batch.calls) yield* runOne(call)
              }
            }
          }),
          () =>
            Effect.forEach(
              [...pending.values()],
              (call) =>
                append(agent, 'tool/result', {
                  callId: call.id,
                  isError: true,
                  content: [{ type: 'text' as const, text: `tool ${call.name} did not finish` }],
                }).pipe(Effect.catchCause(() => Effect.void)),
              { discard: true },
            ),
        )
      })

    const runSteps = (
      agent: Agent,
      turn: number,
      input: ReadonlyArray<UserMessage>,
    ): Effect.Effect<boolean> => {
      const loop = (pending: ReadonlyArray<UserMessage>): Effect.Effect<boolean> =>
        Effect.gen(function* () {
          const step = countEvents(agent.session, 'step/start') + 1
          yield* append(agent, 'step/start', { step })
          const outcome = yield* requestStep(agent, pending)
          if (!outcome.ok) {
            yield* append(agent, 'step/end', { step })
            yield* append(agent, 'turn/end', {
              turn,
              reason: { kind: 'error', failure: encodeLlmFailure(outcome.failure) },
            })
            return false
          }
          const calls = outcome.content.filter(isToolCall)
          if (calls.length === 0) {
            yield* append(agent, 'step/end', { step })
            if (agent.inbox.nextStep.length === 0) return true
            return yield* loop([])
          }
          yield* executeCalls(agent, calls)
          yield* append(agent, 'step/end', { step })
          return yield* loop([])
        })
      return loop(input)
    }

    const runTurn = (agent: Agent): Effect.Effect<void> => {
      const turn = countEvents(agent.session, 'turn/start') + 1
      const program = Effect.gen(function* () {
        yield* append(agent, 'turn/start', { turn })
        const claimed = yield* agent.inbox.claim(true).pipe(Effect.orDie)
        const decision = yield* hooks.waterfall('agent/pre-step', { agent, messages: claimed })
        if (decision?.kind === 'reject') {
          yield* append(agent, 'turn/end', {
            turn,
            reason: {
              kind: 'error',
              failure: encodeLlmFailure(
                new LlmFailure({ code: 'INVALID_REQUEST', message: decision.reason }),
              ),
            },
          })
          return
        }
        const completed = yield* runSteps(agent, turn, claimed)
        if (!completed) return
        yield* hooks.serial('agent/turn-stopping', agent)
        yield* append(agent, 'turn/end', { turn, reason: { kind: 'completed' } })
      })
      const recordAbnormal = (exit: Exit.Exit<void, never>): Effect.Effect<void> =>
        Effect.gen(function* () {
          if (Exit.isSuccess(exit) || recordedTurnEnd(agent.session, turn)) return
          const cause = agent.driver.cancelCause
          const reason =
            cause === undefined
              ? {
                  kind: 'error' as const,
                  failure: encodeLlmFailure(
                    new LlmFailure({ code: 'PROVIDER' as const, message: 'the turn failed' }),
                  ),
                }
              : { kind: 'cancelled' as const, cause }
          yield* append(agent, 'turn/end', { turn, reason }).pipe(
            Effect.catchCause(() => Effect.void),
          )
        })
      return program.pipe(Effect.onExit(recordAbnormal)) as Effect.Effect<void>
    }

    const run: AgentRunner['run'] = (agent: Agent) =>
      Effect.gen(function* () {
        while (true) {
          yield* Queue.take(agent.driver.wake)
          if (!agent.inbox.pending) continue
          yield* agent.driver.setStatus('running')
          yield* runTurn(agent).pipe(Effect.ensuring(agent.driver.setStatus('idle')))
        }
      })

    return { run }
  })

export const agentLoopLayer: Layer.Layer<AgentLoop, never, Hooks | Tools | SystemPrompt | Llm> =
  Layer.effect(AgentLoop, agentLoopEffect)

/** Loader definition for the turn runner. */
export const agentLoopPlugin: Plugin<{}, AgentRunnerService, Hooks | Tools | SystemPrompt | Llm> = {
  name: '@fudo/agent-loop',
  config: Schema.Struct({}),
  provides: [AgentRunnerService],
  requires: [Hooks, Tools, SystemPrompt, Llm],
  layer: () => Layer.effect(AgentRunnerService, agentLoopEffect),
}
