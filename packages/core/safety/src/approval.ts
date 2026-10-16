import { Context, Effect, Layer } from 'effect'
import type { Session } from '@jozo-harness/session'
import type { ApprovalRequested } from './events.ts'

/** Decides one request: true lets the call run, false refuses it. A failing answerer refuses too. */
export type ApprovalAnswerer = (request: ApprovalRequested) => Effect.Effect<boolean, unknown>

export interface ApprovalShape {
  /**
   * Installs the answerer every later request goes to. While nobody is served a
   * request is refused at once, because a seam with no answerer denies rather
   * than waits forever for one that will never come.
   */
  readonly serve: (answer: ApprovalAnswerer) => Effect.Effect<void>
  /** Says that nobody answers any more; later requests are refused at once. */
  readonly stopServing: () => Effect.Effect<void>
  /** Whether somebody is there to answer. */
  readonly served: () => boolean
  /**
   * Asks for one call to run outside what it was denied. Asking is one call wide
   * and never remembered; an answerer that fails or is absent refuses.
   */
  readonly request: (request: ApprovalRequested) => Effect.Effect<boolean>
}

/** Answers are held in memory only: approval is one call wide and never remembered. */
export const makeApproval = (): Effect.Effect<ApprovalShape> =>
  Effect.sync(() => {
    let answerer: ApprovalAnswerer | undefined
    return {
      serve: (answer) =>
        Effect.sync(() => {
          answerer = answer
        }),
      stopServing: () =>
        Effect.sync(() => {
          answerer = undefined
        }),
      served: () => answerer !== undefined,
      request: (request) =>
        answerer === undefined
          ? Effect.succeed(false)
          : answerer(request).pipe(Effect.catchCause(() => Effect.succeed(false))),
    }
  })

export const approvalLayer: Effect.Effect<ApprovalShape> = makeApproval()

/** The approval holder as a service, so tools that escalate can reach it. */
export class Approval extends Context.Service<Approval, ApprovalShape>()('jozo-harness/Approval') {}

export const approvalServiceLayer: Layer.Layer<Approval, never> = Layer.effect(
  Approval,
  makeApproval(),
)

const log = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<boolean> =>
  Effect.match(effect, { onFailure: () => false, onSuccess: () => true })

/**
 * Wraps an answerer so every request and answer lands in the session log, and a
 * question that cannot be recorded or answered is a refusal. The events are
 * log-only: the permission UI and the audit trail are not model history.
 */
export const recordingAnswerer =
  (session: Session, answer: ApprovalAnswerer): ApprovalAnswerer =>
  (request) =>
    Effect.gen(function* () {
      yield* log(session.append('safety/approval/requested', request))
      const approved = yield* answer(request).pipe(Effect.catchCause(() => Effect.succeed(false)))
      yield* log(session.append('safety/approval/answered', { callId: request.callId, approved }))
      return approved
    })
