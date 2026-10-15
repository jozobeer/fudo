import { Hooks } from '@jozo-harness/kernel'
import { Context, Effect, Exit, Layer, Scope, type Fiber } from 'effect'
import type { SessionId } from '@jozo-harness/session'
import { Sessions } from '@jozo-harness/session'
import { makeAgent, type AgentHandle } from './agent.ts'
import './hooks.ts'
import {
  type Agent,
  type AgentError,
  type AgentRunner,
  type AgentsShape,
  type CreateAgentOptions,
} from './types.ts'

export class Agents extends Context.Service<Agents, AgentsShape>()('jozo-harness/Agents') {}

interface Registered {
  readonly agent: Agent
  readonly scope: Scope.Closeable
  readonly handle: AgentHandle
}

/** Builds the agent registry over the sessions and the supplied turn runner. */
export function agentsService(
  runner: AgentRunner,
): Effect.Effect<AgentsShape, never, Sessions | Hooks> {
  return Effect.gen(function* () {
    const sessions = yield* Sessions
    const hooks = yield* Hooks
    const registered = new Map<SessionId, Registered>()

    const dispose = (id: SessionId): Effect.Effect<void> =>
      Effect.gen(function* () {
        const entry = registered.get(id)
        if (entry === undefined) return
        registered.delete(id)
        entry.handle.fiber = undefined
        yield* entry.agent.driver.setStatus('disposed')
        yield* Scope.close(entry.scope, Exit.void)
      })

    return {
      create: (options: CreateAgentOptions): Effect.Effect<Agent, AgentError> =>
        Effect.gen(function* () {
          const session =
            options.resume === undefined
              ? yield* sessions.create({
                  cwd: options.cwd,
                  ...(options.seed === undefined ? {} : { seed: options.seed }),
                })
              : yield* sessions.open(options.resume)
          const scope = yield* Scope.make()
          const handle: AgentHandle = { fiber: undefined }
          const agent = yield* makeAgent({
            id: session.id,
            session,
            options: options.options,
            scope,
            handle,
          })

          yield* Effect.matchEffect(hooks.serial('agent/created', agent), {
            onFailure: (error) =>
              Effect.gen(function* () {
                yield* Scope.close(scope, Exit.fail(error))
                return yield* Effect.fail(error)
              }),
            onSuccess: () => Effect.void,
          })

          const fiber: Fiber.Fiber<void, never> = yield* Effect.forkIn(
            runner.run(agent).pipe(Effect.ensuring(agent.driver.setStatus('idle'))),
            scope,
          )
          handle.fiber = fiber
          registered.set(agent.id, { agent, scope, handle })
          return agent
        }),

      get: (id) => registered.get(id)?.agent,

      list: () => [...registered.values()].map((entry) => entry.agent),

      dispose,

      disposeAll: () =>
        Effect.gen(function* () {
          // Snapshot: dispose removes entries from the map being iterated.
          for (const id of registered.keys().toArray()) yield* dispose(id)
        }),
    }
  })
}

export function agentsLayer(runner: AgentRunner): Layer.Layer<Agents, never, Sessions | Hooks> {
  return Layer.effect(Agents, agentsService(runner))
}

/** The \`Agents\` layer that resolves its turn runner from the context. */
export const agentsFromServiceLayer: Layer.Layer<
  Agents,
  never,
  Sessions | Hooks | AgentRunnerService
> = Layer.effect(
  Agents,
  Effect.gen(function* () {
    const runner = yield* AgentRunnerService
    return yield* agentsService(runner)
  }),
)

export class AgentRunnerService extends Context.Service<AgentRunnerService, AgentRunner>()(
  'jozo-harness/AgentRunner',
) {}
