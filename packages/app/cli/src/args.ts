export interface ParsedArgs {
  readonly profile: string
  readonly patches: ReadonlyArray<string>
  readonly task: string | undefined
  readonly resume: string | undefined
  readonly model: string
  readonly dumpConfig: boolean
  readonly json: boolean
  readonly help: boolean
  readonly errors: ReadonlyArray<string>
}

const VALUE_FLAGS = new Set(['--profile', '--patch', '--resume', '--model'])

/** Parses `fudo` arguments. Positional words join into the one-shot task. */
export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const values = new Map<string, Array<string>>()
  const words: Array<string> = []
  const errors: Array<string> = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? ''
    if (argument.startsWith('--')) {
      if (argument === '--dump-config' || argument === '--json' || argument === '--help') {
        values.set(argument, ['true'])
        continue
      }
      if (!VALUE_FLAGS.has(argument)) {
        errors.push(`unknown option ${argument}`)
        continue
      }
      const value = argv[index + 1]
      if (value === undefined) {
        errors.push(`${argument} needs a value`)
        continue
      }
      values.set(argument, [...(values.get(argument) ?? []), value])
      index += 1
      continue
    }
    words.push(argument)
  }

  const single = (flag: string): string | undefined => values.get(flag)?.[0]
  return {
    profile: single('--profile') ?? 'headless',
    patches: values.get('--patch') ?? [],
    task: words.length === 0 ? undefined : words.join(' '),
    resume: single('--resume'),
    model: single('--model') ?? '',
    dumpConfig: values.has('--dump-config'),
    json: values.has('--json'),
    help: values.has('--help'),
    errors,
  }
}
