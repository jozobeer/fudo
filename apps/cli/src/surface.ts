import { FLAG_NAMES } from './args.ts'
import { CONFIG_HOME_ENV, configPaths } from './config.ts'
import type { FudoConfig } from './config-file.ts'
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
  /** What the key takes, for a reader deciding whether to write it. */
  readonly summary: string
  /** What the settings file holds now, so the dump shows the state. */
  readonly value: (settings: FudoConfig | undefined) => string
}

const countText = (count: number, noun: string): string =>
  String(count) + ' ' + noun + (count === 1 ? '' : 's')

const countOr = (fallback: string, count: number | undefined, noun: string): string =>
  count === undefined ? fallback : countText(count, noun)

export const SETTINGS_KEYS: ReadonlyArray<SettingsNote> = [
  {
    name: 'model',
    summary: 'provider/model',
    value: (settings) => settings?.model ?? 'not set',
  },
  {
    name: 'profile',
    summary: 'a bundled profile name; --profile wins over it',
    value: (settings) => settings?.profile ?? 'not set, so headless is used',
  },
  {
    name: 'skills',
    summary: 'directories that hold <name>/SKILL.md',
    value: (settings) =>
      countOr('not set, so the skill tool is off', settings?.skills?.length, 'directory'),
  },
  {
    name: 'plugins',
    summary: 'rows merged by id, between the profile and --patch',
    value: (settings) => countOr('not set', settings?.plugins?.length, 'row'),
  },
]

/** The route the command resolved, and the layers it looked through. */
export const renderModelInEffect = (route: string): string =>
  route === ''
    ? 'model in effect: none; a run stops with "no model is set"\n'
    : 'model in effect: ' + route + ' (--model > the settings file > a plugin row)\n'

/** The keys no plugin schema declares. */
export const renderRowKeys = (): string =>
  [
    'row keys the command reads itself (no plugin declares these):',
    ...ROW_KEYS.map((key) => '  - ' + key.name + ' (' + key.where + '): ' + key.summary),
  ].join('\n') + '\n'

const renderSettings = (path: string, settings: FudoConfig | undefined): string =>
  [
    'settings (' + path + '):',
    ...SETTINGS_KEYS.map(
      (key) => '  - ' + key.name + ': ' + key.value(settings) + ' — ' + key.summary,
    ),
  ].join('\n') + '\n'

const renderFlags = (): string =>
  ['flags (fudo --help shows how they are used):', '  - ' + FLAG_NAMES.join(' ')].join('\n') + '\n'

const renderEnvironment = (): string =>
  [
    'environment (the shell wins, then the nearest .env, then secrets.env):',
    '  - ' + CONFIG_HOME_ENV + ': moves the directory that holds config.yaml and secrets.env',
    '  - ' + SEARCH_KEY_ENV + ': with it the web_search tool is registered',
  ].join('\n') + '\n'

/** What `--dump-config` prints after the rows: where the rest is set and what it holds. */
export const renderSurface = (
  settingsPath: string | undefined,
  settings: FudoConfig | undefined,
): string =>
  renderRowKeys() +
  renderSettings(settingsPath ?? configPaths().config, settings) +
  renderFlags() +
  renderEnvironment()
