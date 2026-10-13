export interface ParsedArgs {
  readonly profile: string
  /** The raw --profile, so a settings file can be overridden. */
  readonly profileFlag: string | undefined
  readonly patches: ReadonlyArray<string>
  readonly task: string | undefined
  /** `fudo models`: list what the provider offers instead of running. */
  readonly models: boolean
  /** `fudo web`: serve the browser UI instead of running a turn. */
  readonly web: boolean
  /** Port for `fudo web`; 0 asks the system for a free one. */
  readonly port: number
  readonly resume: string | undefined
  readonly model: string
  /** The raw --model, so a settings file can be overridden. */
  readonly modelFlag: string | undefined
  readonly dumpConfig: boolean
  readonly json: boolean
  /** Forces the terminal UI even when stdin is not a terminal. */
  readonly tui: boolean
  readonly config: string | undefined
  readonly help: boolean
  readonly errors: ReadonlyArray<string>
}

interface FlagSpec {
  readonly kind: 'boolean' | 'value'
}

const FLAGS: ReadonlyMap<string, FlagSpec> = new Map<string, FlagSpec>([
  ['--dump-config', { kind: 'boolean' }],
  ['--json', { kind: 'boolean' }],
  ['--tui', { kind: 'boolean' }],
  ['--help', { kind: 'boolean' }],
  ['--profile', { kind: 'value' }],
  ['--patch', { kind: 'value' }],
  ['--resume', { kind: 'value' }],
  ['--model', { kind: 'value' }],
  ['--config', { kind: 'value' }],
  ['--port', { kind: 'value' }],
])

interface ScannedArgs {
  values: Map<string, Array<string>>
  words: Array<string>
  errors: Array<string>
}

/** Applies one argument; returns how many further arguments it consumed. */
const scanOne = (argv: ReadonlyArray<string>, index: number, out: ScannedArgs): number => {
  const argument = argv[index] ?? ''
  if (!argument.startsWith('--')) {
    out.words.push(argument)
    return 0
  }
  const spec = FLAGS.get(argument)
  if (spec === undefined) {
    out.errors.push(`unknown option ${argument}`)
    return 0
  }
  if (spec.kind === 'boolean') {
    out.values.set(argument, ['true'])
    return 0
  }
  const value = argv[index + 1]
  if (value === undefined) {
    out.errors.push(`${argument} needs a value`)
    return 0
  }
  out.values.set(argument, [...(out.values.get(argument) ?? []), value])
  return 1
}

const scan = (argv: ReadonlyArray<string>): ScannedArgs => {
  const out: ScannedArgs = { values: new Map(), words: [], errors: [] }
  let index = 0
  while (index < argv.length) index += 1 + scanOne(argv, index, out)
  return out
}

const first = (values: ReadonlyMap<string, Array<string>>, flag: string): string | undefined =>
  values.get(flag)?.[0]

const portOf = (raw: string | undefined, errors: Array<string>): number => {
  if (raw === undefined) return 0
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    errors.push('--port needs a whole number between 0 and 65535')
    return 0
  }
  return port
}

/** Parses `fudo` arguments. Positional words join into the one-shot task. */
export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const { values, words, errors } = scan(argv)
  const models = words.length === 1 && words[0] === 'models'
  const web = words.length === 1 && words[0] === 'web'
  const port = portOf(first(values, '--port'), errors)
  return {
    profile: first(values, '--profile') ?? 'headless',
    profileFlag: first(values, '--profile'),
    patches: values.get('--patch') ?? [],
    task: words.length === 0 || models || web ? undefined : words.join(' '),
    models,
    web,
    port,
    resume: first(values, '--resume'),
    model: first(values, '--model') ?? '',
    modelFlag: first(values, '--model'),
    dumpConfig: values.has('--dump-config'),
    json: values.has('--json'),
    tui: values.has('--tui'),
    config: first(values, '--config'),
    help: values.has('--help'),
    errors,
  }
}
