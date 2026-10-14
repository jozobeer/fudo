import { loadBundledProfileNamed } from '@fudo/bundle-base'
import { Effect } from 'effect'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { configPaths, type ConfigPaths } from './config.ts'
import { loadConfigFile } from './config-file.ts'
import { SETTINGS_KEYS, renderSettings } from './surface.ts'

export interface ConfigIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

const USAGE =
  'fudo config              the settings file, its keys, and their values\n' +
  'fudo config set K V      write one key (model, profile)\n' +
  'fudo config init         write a starting file with every key commented out\n'

/** The keys a person can set from here; the list keys need the file itself. */
const SCALAR_KEYS: ReadonlyArray<string> = ['model', 'profile']

const GUIDE = [
  'change a key   fudo config set model <provider/model>\n',
  'list models    fudo models\n',
  'secrets        fudo auth add ollama\n',
  'every key      fudo --dump-config\n',
]

const template = (): string =>
  [
    '# fudo settings. Every key is commented out; remove the # to use one.',
    '# fudo config shows what is in effect, fudo --dump-config shows every key.',
    '',
    ...SETTINGS_KEYS.flatMap((note) => [
      '# ' + note.name + ': ' + note.summary,
      ...note.example.map((line) => '# ' + line),
      '',
    ]),
  ].join('\n')

/** Quoting keeps a value that YAML would otherwise read as something else. */
const yamlValue = (value: string): string =>
  /^[A-Za-z0-9._/-]+$/.test(value) ? value : "'" + value.replace(/'/g, "''") + "'"

/** Replaces the key's line in place, or appends it; comments and other keys stay. */
const writeSetting = (path: string, key: string, value: string): void => {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const all = text.split('\n')
  const lines = all.filter((line, index) => !(index === all.length - 1 && line === ''))
  const written = key + ': ' + yamlValue(value)
  const at = lines.findIndex((line) => new RegExp('^' + key + '\\s*:').test(line))
  const updated =
    at === -1 ? [...lines, written] : lines.map((line, i) => (i === at ? written : line))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, updated.join('\n') + '\n')
}

const show = async (io: ConfigIo, paths: ConfigPaths): Promise<number> => {
  const settings = await Effect.runPromise(loadConfigFile(paths.config))
  io.stdout(renderSettings(paths.config, settings))
  if (!existsSync(paths.config)) {
    io.stdout('(no file yet; fudo config init writes a starting one)\n')
  }
  io.stdout('\n' + GUIDE.join(''))
  return 0
}

/** Why the value does not fit the key; undefined when it does. */
const refusal = async (key: string, value: string): Promise<string | undefined> => {
  if (key === 'model') {
    const parts = value.split('/')
    const shaped = parts.length === 2 && parts.every((part) => part !== '' && !/\s/.test(part))
    return shaped ? undefined : 'model takes provider/model (fudo models lists them)'
  }
  const bundled = await loadBundledProfileNamed(value).then(
    () => undefined,
    () => 'no bundled profile named ' + value + ' (base, headless, repl)',
  )
  return bundled
}

const setValue = async (
  argv: ReadonlyArray<string>,
  io: ConfigIo,
  paths: ConfigPaths,
): Promise<number> => {
  const [key = '', value = ''] = argv
  const names = SETTINGS_KEYS.map((note) => note.name)
  if (key === '' || value === '') {
    io.stderr(USAGE)
    return 2
  }
  if (!names.includes(key)) {
    io.stderr('fudo: the settings file takes ' + names.join(', ') + '\n')
    return 2
  }
  if (!SCALAR_KEYS.includes(key)) {
    io.stderr('fudo: ' + key + ' holds a list; edit ' + paths.config + '\n')
    return 2
  }
  const problem = await refusal(key, value)
  if (problem !== undefined) {
    io.stderr('fudo: ' + problem + '\n')
    return 2
  }
  try {
    writeSetting(paths.config, key, value)
  } catch (cause) {
    io.stderr('fudo: cannot write ' + paths.config + ': ' + String(cause) + '\n')
    return 1
  }
  io.stdout('fudo: wrote ' + key + ' in ' + paths.config + '\n  ' + key + ': ' + value + '\n')
  return 0
}

const init = async (io: ConfigIo, paths: ConfigPaths): Promise<number> => {
  if (existsSync(paths.config)) {
    io.stderr('fudo: ' + paths.config + ' already exists; fudo config shows what it holds\n')
    return 1
  }
  try {
    mkdirSync(dirname(paths.config), { recursive: true })
    writeFileSync(paths.config, template())
  } catch (cause) {
    io.stderr('fudo: cannot write ' + paths.config + ': ' + String(cause) + '\n')
    return 1
  }
  io.stdout('fudo: wrote a starting file at ' + paths.config + '\n')
  return 0
}

/** The `fudo config` subcommand: show the settings, set one key, or start a file. */
export async function runConfig(
  argv: ReadonlyArray<string>,
  io: ConfigIo,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const paths = configPaths(env)
  const [command, ...rest] = argv
  if (command === undefined) return await show(io, paths)
  if (command === 'set') return await setValue(rest, io, paths)
  if (command === 'init') return await init(io, paths)
  io.stderr(USAGE)
  return 2
}
