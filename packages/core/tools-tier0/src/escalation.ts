import { Effect, Schema } from 'effect'
import { ToolError } from '@jozo-harness/tools'
import {
  ESCALATION_TARGETS,
  approveEscalation,
  escalationHintMarker,
  sandboxDenialMarker,
  validateEscalationArgs,
  widerModes,
  type ApprovalShape,
  type SandboxMode,
  type SandboxShape,
} from '@jozo-harness/safety'

/** The escalation arguments every fenced tool carries. */
export interface EscalationArgs {
  readonly sandbox_permissions?: SandboxMode
  readonly justification?: string
}

/**
 * The two parameter fields a fenced tool advertises, worded for its own subject:
 * `denied` names what the sandbox refused ("a command", "a file operation") and
 * `noun` names it in the reason the human reads.
 */
export const escalationFields = (denied: string, noun: string) => ({
  sandbox_permissions: Schema.optionalKey(
    Schema.Literals([...ESCALATION_TARGETS]).annotate({
      description:
        'The wider sandbox mode to retry in, once, ' +
        denied +
        ' the sandbox just denied. Only a mode wider than the one this call runs under, and only ' +
        'when something confines it: the retry asks the user, and a refusal keeps it denied. ' +
        'Requires justification.',
    }),
  ),
  justification: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'One sentence on why this ' +
        noun +
        ' has to reach outside the mode it was denied under. Required with sandbox_permissions, ' +
        'and the human reads it.',
    }),
  ),
})

/** Whether this composition can widen one call at all. */
export const escalates = (sandbox: SandboxShape, approval: ApprovalShape | undefined): boolean =>
  approval !== undefined && sandbox.confines && widerModes(sandbox.mode).length > 0

/**
 * The mode one call runs under: the standing mode, or a wider one the human
 * allowed. The argument pairing a schema expresses only loosely is checked first,
 * and a request nothing can honour is refused with the reason.
 */
export const modeOfCall = (input: {
  readonly args: EscalationArgs
  readonly callId: string
  readonly tool: string
  /** The family's noun for the denied action: `command` for bash, `operation` for the file tools. */
  readonly subject: string
  readonly sandbox: SandboxShape
  readonly approval: ApprovalShape | undefined
}): Effect.Effect<SandboxMode, ToolError> =>
  Effect.gen(function* () {
    // A mode without its reason, or a reason driving nothing, is a malformed ask.
    yield* Effect.try({
      try: () => validateEscalationArgs(input.args.sandbox_permissions, input.args.justification),
      catch: (error) =>
        new ToolError({
          code: 'invalid-arguments',
          message: error instanceof Error ? error.message : String(error),
        }),
    })
    const requested = input.args.sandbox_permissions
    if (requested === undefined) return input.sandbox.mode
    if (!escalates(input.sandbox, input.approval)) {
      return yield* Effect.fail(
        new ToolError({
          code: 'execution',
          message:
            'sandbox_permissions is not available here: nothing confines this call, so there is no ' +
            'wider mode to ask for',
        }),
      )
    }
    return yield* approveEscalation(
      {
        requestedMode: requested,
        justification: input.args.justification ?? '',
        standingMode: input.sandbox.mode,
        subject: input.subject,
        callId: input.callId,
        tool: input.tool,
      },
      (request) => (input.approval as ApprovalShape).request(request),
    ).pipe(
      Effect.mapError(
        (error) => new ToolError({ code: 'denied', message: 'sandbox: ' + error.message }),
      ),
    )
  })

/**
 * A denial as the model reads it: why the path was refused, the mode that refused
 * it, and — when this composition can widen the call — the one retry that asks.
 */
export const deniedFor = (
  reason: string,
  mode: SandboxMode,
  subject: string,
  canEscalate: boolean,
): ToolError =>
  new ToolError({
    code: 'denied',
    message: [
      reason,
      sandboxDenialMarker(mode),
      ...(canEscalate ? [escalationHintMarker(subject)] : []),
    ].join('\n'),
  })
