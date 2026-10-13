import { Deferred, Effect, Fiber, Queue, Scope } from 'effect'
import type { Session, SessionError, SessionId } from '@fudo/session'
import { makeInbox } from './inbox.ts'
import type { UserMessage } from './events.ts'
import type { Agent, AgentCancelCause, AgentDriver, AgentOptions, AgentStatus } from './types.ts'

/** Mutable slot the registry fills with the running fiber. */
export interface AgentHandle {
  fiber: Fiber.Fiber<void, never> | undefined
}

export interface MakeAgentOptions {
  readonly id: SessionId
  readonly session: Session
  readonly options: AgentOptions
  readonly scope: Scope.Scope
  readonly handle: AgentHandle
}

/**
 * Builds the agent shell: durable inbox, status, cancellation, and the
 * `whenIdle` wait. Turn execution is the runner's job.
 */
export function makeAgent(input: MakeAgentOptions): Effect.Effect<Agent> {
  return Effect.gen(function* () {
    const inbox = makeInbox(input.session)
    const wake = yield* Queue.unbounded<void>()
    const waiters = new Set<Deferred.Deferred<void>>()
    let status: AgentStatus = 'idle'
    let cancelCause: AgentCancelCause | undefined = undefined

    const settled = (): boolean => status === 'disposed' || (status === 'idle' && !inbox.pending)

    // Snapshot before completing: a resumed waiter may register a new waiter
    // while this loop is still running.
    const notify = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const pending = [...waiters]
        waiters.clear()
        for (const waiter of pending) yield* Deferred.succeed(waiter, void 0)
      })

    const setStatus = (next: AgentStatus): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (status !== 'disposed' || next === 'disposed') status = next
        yield* notify()
      })

    const driver: AgentDriver = {
      setStatus,
      get cancelCause() {
        return cancelCause
      },
      wake,
    }

    const whenIdle = Effect.suspend(() =>
      Effect.gen(function* () {
        while (!settled()) {
          const waiter = yield* Deferred.make<void>()
          waiters.add(waiter)
          if (settled()) {
            waiters.delete(waiter)
            return
          }
          yield* Deferred.await(waiter)
        }
      }),
    )

    const queue = (
      target: 'next-turn' | 'next-step',
      message: UserMessage,
    ): Effect.Effect<void, SessionError> =>
      Effect.gen(function* () {
        yield* inbox.queue(target, message)
        yield* notify()
      })

    return {
      id: input.id,
      session: input.session,
      options: input.options,
      inbox,
      scope: input.scope,
      driver,
      get status() {
        return status
      },
      followup: (message) =>
        Effect.gen(function* () {
          yield* queue('next-turn', message)
          yield* Queue.offer(wake, void 0)
        }),
      steer: (message) => queue('next-step', message),
      inject: (message) => queue('next-step', message),
      cancel: (cause) =>
        Effect.gen(function* () {
          if (status === 'disposed') return
          cancelCause = cause
          if (input.handle.fiber === undefined) return
          yield* setStatus('cancelling')
          yield* Fiber.interrupt(input.handle.fiber)
          yield* setStatus('idle')
        }),
      whenIdle,
    }
  })
}
