import { Hooks } from '@fudo/kernel'
import type { Session } from '@fudo/session'
import type { ToolExecution } from '@fudo/tools'
import { Effect, type Scope } from 'effect'
import { Approval } from './approval.ts'
import type { ApprovalRequested } from './events.ts'
import { Policy } from './policy-service.ts'

const log = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<boolean> =>
  Effect.match(effect, { onFailure: () => false, onSuccess: () => true })

/**
 * Judges every tool call against the preset. Anything outside it becomes a
 * request event; the call waits until an answer arrives. Approval is one call
 * wide: it is never remembered, and it never escalates twice.
 */
export const installApproval = (
  session: Session,
  /**
   * Answers on the spot; without it the call waits for an Approval answer, which
   * only a seam somebody listens on will give.
   */
  answer?: (request: ApprovalRequested) => Effect.Effect<boolean, unknown>,
): Effect.Effect<void, never, Hooks | Policy | Approval | Scope.Scope> =>
  Effect.gen(function* () {
    const hooks = yield* Hooks
    const policy = yield* Policy
    const approval = yield* Approval
    yield* hooks.on('tools/pre-execute', (exec: ToolExecution) =>
      Effect.gen(function* () {
        const decision = policy.decide(exec.needs ?? [])
        if (decision.kind === 'allow') return { kind: 'allow' } as const
        if (decision.kind === 'deny') return { kind: 'deny', reason: decision.reason } as const
        const recorded = yield* log(
          session.append('safety/approval/requested', {
            callId: exec.callId,
            tool: exec.tool,
            reason: decision.reason,
          }),
        )
        if (!recorded) {
          return { kind: 'deny', reason: 'cannot record the approval request' } as const
        }
        // An answerer that fails fails the question closed: the call is refused, not
        // left broken, and never opened by a callback the seam could not read.
        const approved = yield* (
          answer === undefined
            ? approval.request(exec.callId)
            : answer({ callId: exec.callId, tool: exec.tool, reason: decision.reason })
        ).pipe(Effect.catchCause(() => Effect.succeed(false)))
        yield* log(
          session.append('safety/approval/answered', {
            callId: exec.callId,
            approved,
          }),
        )
        return approved
          ? ({ kind: 'allow' } as const)
          : ({ kind: 'deny', reason: 'denied: ' + exec.tool } as const)
      }),
    )
  })
