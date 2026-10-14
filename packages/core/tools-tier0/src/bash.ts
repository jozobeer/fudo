import { Schema, Effect } from 'effect'
import { ToolError, oneLine, type ToolDefinition } from '@fudo/tools'
import { noneSandbox, type SandboxShape } from '@fudo/safety'
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
})

export type BashArgs = Schema.Schema.Type<typeof Parameters>

export interface BashValue {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly timeoutMs: number
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

/** What the run itself has to say: a timeout, then the exit code last, where it is looked for. */
const markersOf = (value: BashValue): ReadonlyArray<string> => [
  ...(value.timedOut ? ['[timed out after ' + String(value.timeoutMs) + 'ms]'] : []),
  ...(value.exitCode === 0 ? [] : ['[exit code: ' + String(value.exitCode) + ']']),
]

const renderOutput = (value: BashValue): string => {
  const body = bodyOf(value)
  const markers = markersOf(value)
  if (markers.length === 0) return body
  return (body.endsWith('\n') ? body : body + '\n') + markers.join('\n')
}

/** Runs one shell command, wrapped by the sandbox the caller chose. A non-zero exit is a result to read, not a failed call. */
export const makeBashTool = (
  sandbox: SandboxShape = noneSandbox,
): ToolDefinition<BashArgs, BashValue> => ({
  name: 'bash',
  presentCall: (args) => ({ summary: 'bash ' + oneLine(args.command).slice(0, 120) }),
  presentResult: (_args, result) => ({ ...result, summary: exitSummaryOf(result.summary) }),
  description:
    'Runs a shell command in the workspace through the configured sandbox and returns what it printed. Check the [exit code: N] marker: a non-zero exit means the command failed. A command still running at the timeout is killed and marked; use job_start for work that should outlive the call. When the output was spilled, read the saved file with offset and limit to see the rest.',
  parameters: Parameters,
  needs: ['exec'],
  output: {
    schema: Schema.Struct({
      exitCode: Schema.Int,
      stdout: Schema.String,
      stderr: Schema.String,
      timedOut: Schema.Boolean,
      timeoutMs: Schema.Int,
    }),
    render: (_args, value) => [{ type: 'text', text: renderOutput(value) }],
  },
  execute: (args, context) =>
    Effect.gen(function* () {
      const cwd = args.cwd === undefined ? context.cwd : yield* resolveInside(context.cwd, args.cwd)
      const wrapped = yield* sandbox
        .wrap({ argv: ['bash', '-lc', args.command], cwd })
        .pipe(
          Effect.mapError(
            (error) => new ToolError({ code: 'execution', message: 'sandbox: ' + error.message }),
          ),
        )
      // A sandbox that refuses the command is an infrastructure failure; a command
      // that runs and exits non-zero is not.
      return yield* Effect.tryPromise({
        try: () => runWrapped(wrapped, clampTimeout(args.timeoutMs)),
        catch: () => new ToolError({ code: 'execution', message: 'cannot run: ' + args.command }),
      })
    }),
})

export const bashTool = makeBashTool()
