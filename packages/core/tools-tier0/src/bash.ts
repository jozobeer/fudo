import { Schema, Effect } from 'effect'
import { ToolError, oneLine, type ToolDefinition } from '@jozo-harness/tools'
import {
  ESCALATION_TARGETS,
  approveEscalation,
  escalationHintMarker,
  noneSandbox,
  sandboxDenialMarker,
  validateEscalationArgs,
  widerModes,
  type ApprovalShape,
  type SandboxMode,
  type SandboxShape,
} from '@jozo-harness/safety'
import { resolveInside } from './workspace.ts'
import { exitSummaryOf } from './present.ts'

/** A command that has not finished by then is killed. */
export const BASH_DEFAULT_TIMEOUT_MS = 120_000
/** The longest a caller may ask for; a command beyond this is background work. */
export const BASH_MAX_TIMEOUT_MS = 600_000
/** After the soft kill, a command that ignores it gets this long before the hard one. */
export const BASH_HARD_KILL_GRACE_MS = 5_000

const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: 'The shell command line to run.' }),
  cwd: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The directory to run in, inside the workspace. Defaults to the current working directory.',
    }),
  ),
  timeoutMs: Schema.optionalKey(
    Schema.Int.annotate({
      description:
        'Kill the command after this many milliseconds. Defaults to 120000; the most allowed is 600000.',
    }),
  ),
  sandbox_permissions: Schema.optionalKey(
    Schema.Literals([...ESCALATION_TARGETS]).annotate({
      description:
        'The wider sandbox mode to retry in, once, a command the sandbox just denied. Only a mode wider ' +
        'than the one the call runs under, and only when something confines it: the retry asks the user, ' +
        'and a refusal keeps the command denied. Requires justification.',
    }),
  ),
  justification: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'One sentence on why this command has to run outside the mode it was denied under. Required ' +
        'with sandbox_permissions, and the human reads it.',
    }),
  ),
})

export type BashArgs = Schema.Schema.Type<typeof Parameters>

export interface BashValue {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly timeoutMs: number
  /** The mode the command ran under, and whether the sandbox refused a file effect. */
  readonly sandbox: {
    readonly mode: SandboxMode
    readonly denied: boolean
  }
}

/** What a denied call says: which mode refused it, and how a retry is asked for. */
const denialOf = (stderr: string, exitCode: number, signatures: ReadonlyArray<string>): boolean => {
  if (exitCode === 0) return false
  const lowered = stderr.toLowerCase()
  return signatures.some((signature) => lowered.includes(signature.toLowerCase()))
}

/** The timeout a call actually gets: a default, never more than the tool allows. */
export const clampTimeout = (asked: number | undefined): number => {
  if (asked === undefined) return BASH_DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(asked, 1), BASH_MAX_TIMEOUT_MS)
}

interface Run {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly timeoutMs: number
}

/** Runs the wrapped command, killing it softly at the timeout and hard shortly after. */
const runWrapped = async (
  wrapped: { readonly argv: ReadonlyArray<string>; readonly cwd: string },
  timeoutMs: number,
): Promise<Run> => {
  const process = Bun.spawn({
    cmd: [...wrapped.argv],
    cwd: wrapped.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdoutText = new Response(process.stdout).text()
  const stderrText = new Response(process.stderr).text()
  let timedOut = false
  const soft = setTimeout(() => {
    timedOut = true
    process.kill()
  }, timeoutMs)
  // A command may trap the soft signal; the hard one is not optional.
  const hard = setTimeout(() => process.kill(9), timeoutMs + BASH_HARD_KILL_GRACE_MS)
  const exitCode = await process.exited
  clearTimeout(soft)
  clearTimeout(hard)
  const [stdout, stderr] = await Promise.all([stdoutText, stderrText])
  return { exitCode, stdout, stderr, timedOut, timeoutMs }
}

/** The output as the model reads it, before anything is said about the run. */
const bodyOf = (value: BashValue): string => {
  if (value.stderr === '') {
    return value.stdout === '' ? '(no output)' : value.stdout
  }
  const separated =
    value.stdout.length > 0 && !value.stdout.endsWith('\n') ? value.stdout + '\n' : value.stdout
  return separated + '[stderr]\n' + value.stderr
}

/** What the run itself has to say: a timeout, the exit code, and a sandbox denial. */
const markersOf = (value: BashValue, escalation: boolean): ReadonlyArray<string> => [
  ...(value.timedOut ? ['[timed out after ' + String(value.timeoutMs) + 'ms]'] : []),
  ...(value.exitCode === 0 ? [] : ['[exit code: ' + String(value.exitCode) + ']']),
  ...(value.sandbox.denied ? [sandboxDenialMarker(value.sandbox.mode)] : []),
  ...(value.sandbox.denied && escalation ? [escalationHintMarker('command')] : []),
]

const renderOutput = (value: BashValue, escalation: boolean): string => {
  const body = bodyOf(value)
  const markers = markersOf(value, escalation)
  if (markers.length === 0) return body
  return (body.endsWith('\n') ? body : body + '\n') + markers.join('\n')
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The mode one call runs under: the standing mode, or a wider one the human allowed. */
const modeFor = (
  args: BashArgs,
  context: { readonly callId: string },
  sandbox: SandboxShape,
  approval: ApprovalShape | undefined,
): Effect.Effect<SandboxMode, ToolError> =>
  Effect.gen(function* () {
    // The pairing a schema cannot express: a mode without its reason, or a reason
    // driving nothing, is a malformed ask.
    yield* Effect.try({
      try: () => validateEscalationArgs(args.sandbox_permissions, args.justification),
      catch: (error) => new ToolError({ code: 'invalid-arguments', message: messageOf(error) }),
    })
    const requested = args.sandbox_permissions
    if (requested === undefined) return sandbox.mode
    if (approval === undefined || !sandbox.confines || widerModes(sandbox.mode).length === 0) {
      return yield* Effect.fail(
        new ToolError({
          code: 'execution',
          message:
            'sandbox_permissions is not available here: nothing confines this command, so there is ' +
            'no wider mode to ask for',
        }),
      )
    }
    return yield* approveEscalation(
      {
        requestedMode: requested,
        justification: args.justification ?? '',
        standingMode: sandbox.mode,
        subject: 'command',
        callId: context.callId,
        tool: 'bash',
      },
      (request) => approval.request(request),
    ).pipe(
      Effect.mapError(
        (error) => new ToolError({ code: 'denied', message: 'sandbox: ' + error.message }),
      ),
    )
  })

/** Runs one shell command, wrapped by the sandbox the caller chose. A non-zero exit is a result to read, not a failed call. */
export const makeBashTool = (
  sandbox: SandboxShape = noneSandbox,
  approval?: ApprovalShape,
): ToolDefinition<BashArgs, BashValue> => {
  const escalates =
    approval !== undefined && sandbox.confines && widerModes(sandbox.mode).length > 0
  return {
    name: 'bash',
    presentCall: (args) => ({ summary: 'bash ' + oneLine(args.command).slice(0, 120) }),
    presentResult: (_args, result) => ({ ...result, summary: exitSummaryOf(result.summary) }),
    description:
      'Runs a shell command in the workspace through the configured sandbox and returns what it printed. Check the [exit code: N] marker: a non-zero exit means the command failed. A command still running at the timeout is killed and marked; use job_start for work that should outlive the call. When the output was spilled, read the saved file with offset and limit to see the rest.' +
      (sandbox.confines
        ? ' A file effect the sandbox refuses is reported as `[sandbox: file access denied under <mode> mode]`: that is a policy denial, so do not retry another way.'
        : ''),
    parameters: Parameters,
    needs: ['exec'],
    output: {
      schema: Schema.Struct({
        exitCode: Schema.Int,
        stdout: Schema.String,
        stderr: Schema.String,
        timedOut: Schema.Boolean,
        timeoutMs: Schema.Int,
        sandbox: Schema.Struct({
          mode: Schema.Literals([...ESCALATION_TARGETS, 'read-only']),
          denied: Schema.Boolean,
        }),
      }),
      render: (_args, value) => [{ type: 'text', text: renderOutput(value, escalates) }],
    },
    execute: (args, context) =>
      Effect.gen(function* () {
        const cwd =
          args.cwd === undefined ? context.cwd : yield* resolveInside(context.cwd, args.cwd)
        const mode = yield* modeFor(args, context, sandbox, approval)
        const wrapped = yield* sandbox
          .wrap({ argv: ['bash', '-lc', args.command], cwd, mode })
          .pipe(
            Effect.mapError(
              (error) => new ToolError({ code: 'execution', message: 'sandbox: ' + error.message }),
            ),
          )
        // A sandbox that refuses the command is an infrastructure failure; a command
        // that runs and exits non-zero is not.
        const run = yield* Effect.tryPromise({
          try: () => runWrapped(wrapped, clampTimeout(args.timeoutMs)),
          catch: () => new ToolError({ code: 'execution', message: 'cannot run: ' + args.command }),
        })
        return {
          ...run,
          sandbox: {
            mode: wrapped.mode,
            denied: denialOf(run.stderr, run.exitCode, wrapped.denialSignatures),
          },
        }
      }),
  }
}

export const bashTool = makeBashTool()
