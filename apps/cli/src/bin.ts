import { loadBundledProfile, loadBundledProfileNamed } from '@fudo/bundle-base'
import { type PluginRow } from '@fudo/kernel'
import type { TuiIo } from '@fudo/tui'
import { Effect, Stream } from 'effect'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type SearchHost } from '@fudo/tools-tier1'
import { parseArgs, type ParsedArgs } from './args.ts'
import { configPaths, loadSecrets } from './config.ts'
import { loadConfigFile, type FudoConfig } from './config-file.ts'
import { loadEnvFrom } from './env-file.ts'
import { listModels, modelEndpointOf } from './models.ts'
import { bundledPlugins } from './plugins.ts'
import { searchFromEnv } from './search-env.ts'
import { profileRows, runCommand, type CommandOptions } from './index.ts'

export interface MainIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
  readonly cwd: string
  /** Batch input; the real entry point streams process.stdin when it is not a terminal. */
  readonly lines?: Stream.Stream<string>
  /** The terminal UI; the real entry point builds one when stdin is a terminal. */
  readonly tui?: TuiIo
  /** True when the caller sits on a terminal. */
  readonly tty?: boolean
  /** Completes to request a user cancellation of the running turn. */
  readonly interrupt?: Effect.Effect<void>
}

const HELP = `fudo "task"                     one-shot headless run
fudo                             terminal UI (a terminal is required)
fudo --profile <name> --patch <file.yml>...
fudo --config <file.yml>        settings (default: ~/.config/fudo/config.yaml)
fudo --model <provider/model>    the route to use (fudo models lists them)
fudo --dump-config
fudo config [set K V|init]       settings: show them, write one key, start a file
fudo models                      list the models the provider offers
fudo web [--port N]              browser UI over a local server
fudo --resume <sessionId> [task]
fudo --allow-preset-change         continue a session under a changed composition
fudo --json "task"
fudo --tui                       terminal UI even through a pipe
`

/** Everything the command reads from the environment and files before running. */
interface CommandInputs {
  readonly settings: FudoConfig
  /** The file the settings came from, so `--dump-config` can name it. */
  readonly settingsPath: string
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
    const settingsPath = parsed.config ?? configPaths().config
    const settings = yield* loadConfigFile(settingsPath)
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
      settingsPath,
      route,
      documents: [base, named],
      patches,
      search: searchFromEnv(process.env),
    }
  })

/** Every model the profile's provider offers, as sorted routes. */
const routesOf = (rows: ReadonlyArray<PluginRow>): Effect.Effect<ReadonlyArray<string>, Error> => {
  const endpoint = modelEndpointOf(rows)
  return endpoint === undefined
    ? Effect.fail(new Error('the profile has no @fudo/llm-openai row to ask for models'))
    : listModels(endpoint, process.env)
}

type Present<K extends keyof CommandOptions> = Pick<CommandOptions, K>

/** A field is left out entirely when its value is missing; exactOptionalPropertyTypes. */
const optional = <K extends keyof CommandOptions>(
  key: K,
  value: CommandOptions[K] | undefined,
): Present<K> | Record<never, never> =>
  value === undefined ? {} : ({ [key]: value } as Present<K>)

const workSelection = (
  parsed: ParsedArgs,
  io: MainIo,
): Present<'task'> | Present<'tui'> | Present<'web'> | Present<'lines'> | Record<never, never> => {
  if (parsed.task !== undefined) return { task: parsed.task }
  if (parsed.web) return { web: { port: parsed.port } }
  const tui = io.tui
  if (tui !== undefined && !parsed.json && (parsed.tui || io.tty === true)) return { tui }
  return io.lines === undefined ? {} : { lines: io.lines }
}

const commandOptions = (parsed: ParsedArgs, io: MainIo, inputs: CommandInputs): CommandOptions => ({
  profiles: inputs.documents,
  plugins: bundledPlugins,
  cwd: io.cwd,
  route: inputs.route,
  // The fudo home: where the sessions root lives, so user-global instructions sit there too.
  fudoHome: join(homedir(), '.fudo'),
  settingsPath: inputs.settingsPath,
  settings: inputs.settings,
  stdout: io.stdout,
  stderr: io.stderr,
  ...optional('extraRows', inputs.settings.plugins),
  ...optional('skills', inputs.settings.skills),
  ...optional('search', inputs.search),
  ...workSelection(parsed, io),
  ...optional('resume', parsed.resume),
  ...(parsed.allowPresetChange ? { allowPresetChange: true } : {}),
  ...(inputs.patches.length === 0 ? {} : { patches: inputs.patches }),
  ...(parsed.dumpConfig ? { dumpConfig: true } : {}),
  ...(parsed.json ? { json: true } : {}),
  ...optional('interrupt', io.interrupt),
})

/** `fudo models`: one route per line on stdout; a failure is one line on stderr. */
const printModels = (inputs: CommandInputs, io: MainIo): Effect.Effect<number> =>
  profileRows({
    profiles: inputs.documents,
    patches: inputs.patches,
    ...optional('extraRows', inputs.settings.plugins),
  }).pipe(
    Effect.flatMap(routesOf),
    Effect.match({
      onFailure: (error) => {
        io.stderr(`fudo: ${error.message}\n`)
        return 1
      },
      onSuccess: (routes) => {
        io.stdout(routes.map((route) => route + '\n').join(''))
        return 0
      },
    }),
  )

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
    if (parsed.models) return yield* printModels(inputs, io)
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
