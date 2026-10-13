import { Deferred, Effect } from 'effect'

export interface ApprovalShape {
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
    return {
      request: (callId) =>
        Effect.gen(function* () {
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
