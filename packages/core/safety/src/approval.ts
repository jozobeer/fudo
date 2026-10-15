import { Context, Deferred, Effect, Layer } from 'effect'

export interface ApprovalShape {
  /**
   * Says that somebody is ready to answer: from here a request waits for `answer`.
   * While nobody listens every request is refused at once, because a seam with no
   * answerer denies rather than waits forever for one that will never come.
   */
  readonly listen: () => Effect.Effect<void>
  /** Says that nobody answers any more; later requests are refused at once. */
  readonly stopListening: () => Effect.Effect<void>
  /** Waits for the answer to one request. Callers append the request event themselves. */
  readonly request: (callId: string) => Effect.Effect<boolean>
  /** Answers a pending request; false when nothing was waiting. */
  readonly answer: (callId: string, approved: boolean) => Effect.Effect<boolean>
  /** The call ids still waiting for an answer. */
  readonly pending: () => ReadonlyArray<string>
}

/** Answers are held in memory only: approval is one call wide and never remembered. */
export const makeApproval = (): Effect.Effect<ApprovalShape> =>
  Effect.sync(() => {
    const waiting = new Map<string, Deferred.Deferred<boolean>>()
    let listening = false
    return {
      listen: () =>
        Effect.sync(() => {
          listening = true
        }),
      stopListening: () =>
        Effect.sync(() => {
          listening = false
        }),
      request: (callId) =>
        Effect.gen(function* () {
          if (!listening) return false
          const answer = yield* Deferred.make<boolean>()
          waiting.set(callId, answer)
          return yield* Deferred.await(answer)
        }),
      answer: (callId, approved) =>
        Effect.gen(function* () {
          const answer = waiting.get(callId)
          if (answer === undefined) return false
          waiting.delete(callId)
          yield* Deferred.succeed(answer, approved)
          return true
        }),
      pending: () => waiting.keys().toArray(),
    }
  })

export const approvalLayer: Effect.Effect<ApprovalShape> = makeApproval()

/** The approval holder as a service, so a pre-execute bridge can reach it. */
export class Approval extends Context.Service<Approval, ApprovalShape>()('jozo-harness/Approval') {}

export const approvalServiceLayer: Layer.Layer<Approval, never> = Layer.effect(
  Approval,
  makeApproval(),
)
