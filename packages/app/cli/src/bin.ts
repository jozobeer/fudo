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
import { type SearchHost } from '@fudo/tools-tier1'
import { parseArgs, type ParsedArgs } from './args.ts'
import { configPaths, loadSecrets } from './config.ts'
import { loadConfigFile, type FudoConfig } from './config-file.ts'
import { loadEnvFrom } from './env-file.ts'
import { searchFromEnv } from './search-env.ts'
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
fudo --config <file.yml>        settings (default: ~/.config/fudo/config.yaml)
fudo --dump-config
fudo --resume <sessionId> [task]
fudo --json "task"
`

/** Everything the command reads from the environment and files before running. */
interface CommandInputs {
  readonly settings: FudoConfig
  readonly route: string
  readonly documents: ReadonlyArray<string>
  readonly patches: ReadonlyArray<string>
  readonly search: SearchHost | undefined
}

const readText = (
  read: () => Promise<string>,
  describe: (cause: unknown) => string,
): Effect.Effect<string, Error> =>
  Effect.tryPromise({ try: read, catch: (cause) => new Error(describe(cause)) })

const loadInputs = (parsed: ParsedArgs, io: MainIo): Effect.Effect<CommandInputs, Error> =>
  Effect.gen(function* () {
    // The nearest .env fills what the environment does not define; the
    // secrets file is separate so it can stay unreadable.
    loadEnvFrom(io.cwd)
    loadSecrets(configPaths().secrets, process.env, io.stderr)
    const settings = yield* loadConfigFile(parsed.config ?? configPaths().config)
    const profileName = parsed.profileFlag ?? settings.profile ?? parsed.profile
    const route = parsed.modelFlag ?? settings.model ?? parsed.model
    const base = yield* readText(
      loadBundledProfile,
      (cause) => `cannot read the bundled profile: ${String(cause)}`,
    )
    const named = yield* readText(
      () => loadBundledProfileNamed(profileName),
      (cause) => `cannot read profile ${profileName}: ${String(cause)}`,
    )
    const patches = yield* Effect.forEach(parsed.patches, (path) =>
      readText(
        () => Bun.file(path).text(),
        (cause) => `cannot read patch ${path}: ${String(cause)}`,
      ),
    )
    return {
      settings,
      route,
      documents: [base, named],
      patches,
      search: searchFromEnv(process.env),
    }
  })

type Present<K extends keyof CommandOptions> = Pick<CommandOptions, K>

/** A field is left out entirely when its value is missing; exactOptionalPropertyTypes. */
const optional = <K extends keyof CommandOptions>(
  key: K,
  value: CommandOptions[K] | undefined,
): Present<K> | Record<never, never> =>
  value === undefined ? {} : ({ [key]: value } as Present<K>)

const taskOrLines = (
  parsed: ParsedArgs,
  io: MainIo,
): Present<'task'> | Present<'lines'> | Record<never, never> =>
  parsed.task !== undefined
    ? { task: parsed.task }
    : io.lines === undefined
      ? {}
      : { lines: io.lines }

const commandOptions = (parsed: ParsedArgs, io: MainIo, inputs: CommandInputs): CommandOptions => ({
  profiles: inputs.documents,
  plugins: bundledPlugins,
  cwd: io.cwd,
  route: inputs.route,
  stdout: io.stdout,
  stderr: io.stderr,
  ...optional('extraRows', inputs.settings.plugins),
  ...optional('skills', inputs.settings.skills),
  ...optional('search', inputs.search),
  ...taskOrLines(parsed, io),
  ...optional('resume', parsed.resume),
  ...(inputs.patches.length === 0 ? {} : { patches: inputs.patches }),
  ...(parsed.dumpConfig ? { dumpConfig: true } : {}),
  ...(parsed.json ? { json: true } : {}),
  ...optional('interrupt', io.interrupt),
})

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
    const inputs = yield* loadInputs(parsed, io)
    return yield* runCommand(commandOptions(parsed, io, inputs))
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        io.stderr(`fudo: ${String(cause)}\n`)
        return 1
      }),
    ),
  )
}
