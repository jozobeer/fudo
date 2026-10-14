import { FLAG_NAMES } from './args.ts'
import { CONFIG_HOME_ENV, configPaths } from './config.ts'
import { SEARCH_KEY_ENV } from './search-env.ts'

/** Row keys the command reads from a row's config itself; no plugin declares them. */
export const MODEL_KEY = 'model'
export const SPILL_BYTES_KEY = 'maxSpillBytes'
export const PLAN_MODE_KEY = 'planMode'

interface RowKeyNote {
  readonly name: string
  readonly where: string
  readonly summary: string
}

export const ROW_KEYS: ReadonlyArray<RowKeyNote> = [
  {
    name: MODEL_KEY,
    where: 'any row',
    summary: 'the route to use when --model and the settings file set none',
  },
  {
    name: SPILL_BYTES_KEY,
    where: 'any row',
    summary: 'tool output above this many bytes goes to a file',
  },
  {
    name: PLAN_MODE_KEY,
    where: 'the @fudo/safety row',
    summary: 'true hides the tools that change the workspace',
  },
]

interface SettingsNote {
  readonly name: string
  readonly summary: string
}

export const SETTINGS_KEYS: ReadonlyArray<SettingsNote> = [
  { name: 'model', summary: 'the route to use, as provider/model; --model wins over it' },
  {
    name: 'profile',
    summary: 'one bundled profile to add (base, headless, repl); --profile wins over it',
  },
  {
    name: 'skills',
    summary: 'directories that hold <name>/SKILL.md; without one the skill tool is off',
  },
  { name: 'plugins', summary: 'rows merged by id, between the profile and --patch' },
]

/** The keys no plugin schema declares. */
export const renderRowKeys = (): string =>
  [
    'row keys the command reads itself (no plugin declares these):',
    ...ROW_KEYS.map((key) => '  - ' + key.name + ' (' + key.where + '): ' + key.summary),
  ].join('\n') + '\n'

const renderSettings = (path: string): string =>
  [
    'settings (' + path + '):',
    ...SETTINGS_KEYS.map((key) => '  - ' + key.name + ': ' + key.summary),
  ].join('\n') + '\n'

const renderFlags = (): string =>
  ['flags (fudo --help shows how they are used):', '  - ' + FLAG_NAMES.join(' ')].join('\n') + '\n'

const renderEnvironment = (): string =>
  [
    'environment (the shell wins, then the nearest .env, then secrets.env):',
    '  - ' + CONFIG_HOME_ENV + ': moves the directory that holds config.yaml and secrets.env',
    '  - ' + SEARCH_KEY_ENV + ': with it the web_search tool is registered',
  ].join('\n') + '\n'

/** What `--dump-config` prints after the effective rows: where the rest is set. */
export const renderSurface = (settingsPath: string | undefined): string =>
  renderRowKeys() +
  renderSettings(settingsPath ?? configPaths().config) +
  renderFlags() +
  renderEnvironment()
