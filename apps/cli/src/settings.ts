import type { PluginRow } from '@fudo/kernel'
import type { FudoConfig } from './config-file.ts'

/** Where an effective value came from, nearest first. */
export type SettingSource = 'flag' | 'settings' | 'environment' | 'default'

/** One effective value, and what decided it. */
export interface Resolved<T> {
  readonly value: T
  readonly source: SettingSource
  /** The thing that decided it, named the way a person would say it. */
  readonly from: string
}

export interface SettingsInputs {
  /** The command line, which wins over everything. */
  readonly flags: {
    readonly profile?: string | undefined
    readonly model?: string | undefined
  }
  readonly settings: FudoConfig
  readonly settingsPath: string
  /** The profile name when neither a flag nor the settings file chooses one. */
  readonly fallbackProfile: string
  /** The route when neither a flag nor the settings file chooses one. */
  readonly fallbackRoute: string
}

export interface EffectiveSettings {
  readonly profile: Resolved<string>
  readonly route: Resolved<string>
  readonly skills: Resolved<ReadonlyArray<string>>
  readonly plugins: Resolved<ReadonlyArray<PluginRow>>
}

const named = (value: string | undefined): value is string => value !== undefined && value !== ''

/**
 * The first candidate that has a value decides, and it says so. One place answers
 * "what is in effect, and why" for the run path and for `fudo config`, so the two
 * cannot drift apart.
 */
const first = <T>(
  candidates: ReadonlyArray<readonly [T | undefined, SettingSource, string]>,
  fallback: readonly [T, string],
): Resolved<T> => {
  for (const [value, source, from] of candidates) {
    if (value !== undefined) return { value, source, from }
  }
  return { value: fallback[0], source: 'default', from: fallback[1] }
}

const fromFile = <T>(value: T | undefined, path: string, empty: T, what: string): Resolved<T> =>
  value === undefined
    ? { value: empty, source: 'default', from: what }
    : { value, source: 'settings', from: path }

/** Resolves the settings a run will use, each with the source that decided it. */
export const resolveSettings = (inputs: SettingsInputs): EffectiveSettings => ({
  profile: first(
    [
      [
        named(inputs.flags.profile) ? inputs.flags.profile : undefined,
        'flag',
        'the --profile on the command line',
      ],
      [
        named(inputs.settings.profile) ? inputs.settings.profile : undefined,
        'settings',
        inputs.settingsPath,
      ],
    ],
    [inputs.fallbackProfile, 'the profile named on the command line'],
  ),
  route: first(
    [
      [
        named(inputs.flags.model) ? inputs.flags.model : undefined,
        'flag',
        'the --model on the command line',
      ],
      [
        named(inputs.settings.model) ? inputs.settings.model : undefined,
        'settings',
        inputs.settingsPath,
      ],
    ],
    [inputs.fallbackRoute, 'the model named on the command line'],
  ),
  skills: fromFile(
    inputs.settings.skills,
    inputs.settingsPath,
    [],
    'no skills configured, so the skill tool is off',
  ),
  plugins: fromFile(inputs.settings.plugins, inputs.settingsPath, [], 'no extra plugin rows'),
})

/** The file a credential came from: the shell, the nearest .env, or secrets.env. */
export type CredentialSource = 'environment' | 'dotenv' | 'secrets'

export interface CredentialInputs {
  readonly name: string
  readonly environment: Readonly<Record<string, string | undefined>>
  /** Names the nearest .env filled, and secrets.env filled after it. */
  readonly fromDotenv: ReadonlyArray<string>
  readonly fromSecrets: ReadonlyArray<string>
}

/** What the run path resolved, and what the file loaders had to fill. */
export interface SettingsSurface {
  readonly effective: EffectiveSettings
  readonly filled: {
    readonly fromDotenv: ReadonlyArray<string>
    readonly fromSecrets: ReadonlyArray<string>
  }
}

/**
 * Where one credential came from. The loaders only fill what the shell leaves
 * empty, so a name they filled was not in the shell: .env is nearer than
 * secrets.env, which is the file to keep unreadable.
 */
export const credentialSource = (inputs: CredentialInputs): CredentialSource | undefined => {
  // The nearest source that filled it wins, and the shell is not in either list
  // because the file loaders never overwrite it.
  if (inputs.fromDotenv.includes(inputs.name)) return 'dotenv'
  if (inputs.fromSecrets.includes(inputs.name)) return 'secrets'
  const present = inputs.environment[inputs.name]
  return present !== undefined && present !== '' ? 'environment' : undefined
}
