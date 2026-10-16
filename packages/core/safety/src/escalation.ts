import { Effect } from 'effect'
import { SandboxError } from './sandbox.ts'
import { widerModes, type SandboxMode } from './policy.ts'
import type { ApprovalRequested } from './events.ts'

/**
 * Every mode a call may escalate TO, narrowest first. `read-only` is the floor:
 * nothing escalates to it, and a composition that advertises these fields is one
 * whose sandbox holds the standing mode below them.
 */
export const ESCALATION_TARGETS: ReadonlyArray<SandboxMode> = [
  'workspace-write',
  'danger-full-access',
]

/**
 * The model-facing denial marker — the one vocabulary that says a file effect was
 * refused by the sandbox, not by the command.
 * @param mode - the mode the denied call ran under.
 */
export const sandboxDenialMarker = (mode: SandboxMode): string =>
  `[sandbox: file access denied under ${mode} mode]`

/**
 * The same-turn hint that rides a denial: the sanctioned retry, and who it asks.
 * @param subject - this family's noun for the denied action (`command` for bash).
 */
export const escalationHintMarker = (subject: string): string =>
  `[sandbox: escalation available — retry this exact ${subject} once with sandbox_permissions ` +
  `(the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`

/**
 * Validate the escalation argument pairing a tool schema expresses only loosely:
 * the mode and its reason travel together — an approval prompt without a reason,
 * or a reason driving nothing, is a malformed ask — and the reason is a sentence.
 * @param sandboxPermissions - the raw `sandbox_permissions` argument, if given.
 * @param justification - the raw `justification` argument, if given.
 */
export function validateEscalationArgs(
  sandboxPermissions: string | undefined,
  justification: string | undefined,
): void {
  if (sandboxPermissions !== undefined && justification === undefined) {
    throw new Error('invalid escalation: sandbox_permissions requires a justification')
  }
  if (justification !== undefined && sandboxPermissions === undefined) {
    throw new Error(
      'invalid escalation: justification is only valid together with sandbox_permissions',
    )
  }
  if (justification !== undefined && justification.trim().length === 0) {
    throw new Error('invalid justification: expected a non-empty sentence')
  }
}

/** One call's request to run outside the mode it was denied under. */
export interface EscalationRequest {
  /** The mode the caller asked for, straight from the arguments. */
  readonly requestedMode: string
  /** Why this call has to run wider; the human reads it. */
  readonly justification: string
  /** The mode the call would run under without this request. */
  readonly standingMode: SandboxMode
  /** The family's noun for the denied action. */
  readonly subject: string
  readonly callId: string
  readonly tool: string
}

/**
 * Resolves one escalation into the mode this call may run under. Strictly wider
 * only, checked here rather than in a schema: the standing mode is per-call truth.
 * The retry asks the human once, and a refusal — or an answerer that fails — keeps
 * the call denied.
 * @param request - what the caller asked for and what it runs under now.
 * @param ask - the approval seam, or any answerer with its shape.
 * @returns the approved mode, or the reason the call stays denied.
 */
export const approveEscalation = (
  request: EscalationRequest,
  ask: (request: ApprovalRequested) => Effect.Effect<boolean>,
): Effect.Effect<SandboxMode, SandboxError> =>
  Effect.gen(function* () {
    const target = ESCALATION_TARGETS.find((mode) => mode === request.requestedMode)
    if (target === undefined) {
      return yield* Effect.fail(
        new SandboxError({ message: 'unknown sandbox mode: ' + request.requestedMode }),
      )
    }
    if (!widerModes(request.standingMode).includes(target)) {
      return yield* Effect.fail(
        new SandboxError({
          message:
            '"' +
            target +
            '" is not wider than "' +
            request.standingMode +
            '", the mode this call already runs under',
        }),
      )
    }
    const approved = yield* ask({
      callId: request.callId,
      tool: request.tool,
      reason: 'escalate to ' + target + ': ' + request.justification,
    }).pipe(Effect.catchCause(() => Effect.succeed(false)))
    if (!approved) {
      return yield* Effect.fail(
        new SandboxError({
          message: 'the user rejected escalating this ' + request.subject + ' to "' + target + '"',
        }),
      )
    }
    return target
  })
