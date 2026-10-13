import type { Agent } from '@fudo/agent'
import type { HookRegistry } from '@fudo/kernel'
import type { Session } from '@fudo/session'
import type { UiEvent, UiHost } from '@fudo/ui-protocol'
import { Deferred, Effect, Queue, Stream, type Scope } from 'effect'

export interface MakeUiHostOptions {
  readonly session: Session
  readonly agent: Agent
  readonly hooks: HookRegistry
}

/**
 * Binds one running agent to the UI protocol. The host owns the wait for
 * approvals and questions, so a UI answers through commands and never through
 * a callback.
 */
export const makeUiHost = (options: MakeUiHostOptions): Effect.Effect<UiHost, never, Scope.Scope> =>
  Effect.gen(function* () {
    const subscribers = new Set<Queue.Queue<UiEvent>>()
    const approvals = new Map<string, Deferred.Deferred<boolean>>()
    const asks = new Map<string, Deferred.Deferred<string>>()

    const publish = (event: UiEvent): void => {
      for (const queue of subscribers.values().toArray()) Queue.offerUnsafe(queue, event)
    }

    yield* options.hooks.on('session/event', (event, session) => {
      if (session !== options.session) return
      // The wait is registered the moment the request is logged: the caller
      // appends the event just before it starts waiting, so no answer is lost.
      if (event.type === 'safety/approval/requested') {
        approvals.set(event.data.callId, Deferred.makeUnsafe<boolean>())
      }
      if (event.type === 'safety/approval/answered') approvals.delete(event.data.callId)
      if (event.type === 'interaction/ask/requested') {
        asks.set(event.data.id, Deferred.makeUnsafe<string>())
      }
      if (event.type === 'interaction/ask/answered') asks.delete(event.data.id)
      publish({ kind: 'session', event })
    })

    yield* options.hooks.on('agent/assistant-stream', (chunk, agent) => {
      if (agent !== options.agent) return
      publish({ kind: 'stream', chunk })
    })

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        subscribers.clear()
      }),
    )

    // The entry outlives the answer: a waiter that starts after the command
    // still finds a settled Deferred. The answered event removes it.
    const settle = <A>(
      waiting: Map<string, Deferred.Deferred<A>>,
      key: string,
      value: A,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const pending = waiting.get(key)
        if (pending !== undefined) yield* Deferred.succeed(pending, value)
      })

    const waitFor = <A>(
      waiting: Map<string, Deferred.Deferred<A>>,
      key: string,
      missing: A,
    ): Effect.Effect<A> =>
      Effect.gen(function* () {
        const pending = waiting.get(key)
        return pending === undefined ? missing : yield* Deferred.await(pending)
      })

    return {
      events: Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const queue = yield* Queue.unbounded<UiEvent>()
            for (const event of options.session.events()) {
              yield* Queue.offer(queue, { kind: 'session', event })
            }
            subscribers.add(queue)
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                subscribers.delete(queue)
              }),
            )
            return Stream.fromQueue(queue)
          }),
        ),
      ),
      submit: (text) => options.agent.followup({ text, source: 'user' }),
      approve: (callId, approved) => settle(approvals, callId, approved),
      answer: (id, answer) => settle(asks, id, answer),
      cancel: () => options.agent.cancel('user'),
      // Without a request there is nothing to allow: deny rather than hang.
      answerApproval: (request) => waitFor(approvals, request.callId, false),
      answerAsk: (request) => waitFor(asks, request.id, ''),
    }
  })
