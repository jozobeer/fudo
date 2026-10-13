import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { loadBundledProfile, loadBundledProfileNamed } from '@fudo/bundle-base'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { llmOpenAiPlugin } from '@fudo/llm-openai'
import { sessionPlugin } from '@fudo/session'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { tier0Plugin } from '@fudo/tools-tier0'
import { tier1Plugin } from '@fudo/tools-tier1'
import { sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { Effect, Stream } from 'effect'
import { parseArgs } from './args.ts'
import { runCommand, type CommandOptions } from './index.ts'

/** Every plugin the S1 bundle can assemble. */
export const bundledPlugins: ReadonlyArray<Plugin<any, any, any>> = [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  llmOpenAiPlugin,
  agentPlugin,
  agentLoopPlugin,
  safetyPlugin,
  askPlugin,
  tier0Plugin,
  tier1Plugin,
]

export interface MainIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
  readonly cwd: string
  /** REPL input; the real entry point streams process.stdin. */
  readonly lines?: Stream.Stream<string>
  /** Completes to request a user cancellation of the running turn. */
  readonly interrupt?: Effect.Effect<void>
}

const HELP = `fudo "task"                     one-shot headless run
fudo                             REPL (later slice)
fudo --profile <name> --patch <file.yml>...
fudo --dump-config
fudo --resume <sessionId> [task]
fudo --json "task"
`

/** The `fudo` entry point: parse argv, load the bundled base profile, run. */
export function main(argv: ReadonlyArray<string>, io: MainIo): Effect.Effect<number> {
  const parsed = parseArgs(argv)
  if (parsed.help) {
    io.stdout(HELP)
    return Effect.succeed(0)
  }
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) io.stderr(`fudo: ${error}\n`)
    return Effect.succeed(2)
  }
  return Effect.gen(function* () {
    const base = yield* Effect.tryPromise({
      try: () => loadBundledProfile(),
      catch: (cause) => new Error(`cannot read the bundled profile: ${String(cause)}`),
    })
    const profileLayer = yield* Effect.tryPromise({
      try: () => loadBundledProfileNamed(parsed.profile),
      catch: (cause) => new Error('cannot read profile ' + parsed.profile + ': ' + String(cause)),
    })
    const patches: Array<string> = []
    for (const path of parsed.patches) {
      patches.push(
        yield* Effect.tryPromise({
          try: () => Bun.file(path).text(),
          catch: (cause) => new Error(`cannot read patch ${path}: ${String(cause)}`),
        }),
      )
    }
    const options: CommandOptions = {
      profiles: [base, profileLayer],
      plugins: bundledPlugins,
      cwd: io.cwd,
      route: parsed.model,
      stdout: io.stdout,
      stderr: io.stderr,
      ...(parsed.task === undefined
        ? io.lines === undefined
          ? {}
          : { lines: io.lines }
        : { task: parsed.task }),
      ...(parsed.resume === undefined ? {} : { resume: parsed.resume }),
      ...(patches.length === 0 ? {} : { patches }),
      ...(parsed.dumpConfig ? { dumpConfig: true } : {}),
      ...(parsed.json ? { json: true } : {}),
      ...(io.interrupt === undefined ? {} : { interrupt: io.interrupt }),
    }
    return yield* runCommand(options)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        io.stderr(`fudo: ${String(cause)}\n`)
        return 1
      }),
    ),
  )
}
