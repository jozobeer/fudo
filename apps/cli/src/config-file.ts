import { existsSync } from 'node:fs'
import { PluginError, PluginRowSchema, type PluginRow } from '@fudo/kernel'
import { Effect, Schema } from 'effect'

/** The settings file: defaults for the command line plus extra plugin rows. */
export const ConfigFileSchema = Schema.Struct({
  model: Schema.optionalKey(Schema.String),
  profile: Schema.optionalKey(Schema.String),
  skills: Schema.optionalKey(Schema.Array(Schema.String)),
  plugins: Schema.optionalKey(Schema.Array(PluginRowSchema)),
})

export interface FudoConfig {
  readonly model?: string | undefined
  readonly profile?: string | undefined
  readonly skills?: ReadonlyArray<string> | undefined
  readonly plugins?: ReadonlyArray<PluginRow> | undefined
}

const configError = (message: string): PluginError => new PluginError({ code: 'config', message })

/** Parses one YAML settings document. Unknown keys are ignored on purpose. */
export function parseConfigText(text: string): Effect.Effect<FudoConfig, PluginError> {
  return Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => Bun.YAML.parse(text) as unknown,
      catch: (cause) => configError('settings are not valid YAML: ' + String(cause)),
    })
    return yield* Schema.decodeUnknownEffect(ConfigFileSchema)(raw).pipe(
      Effect.mapError((issue) => configError('settings do not match the schema: ' + issue.message)),
    )
  })
}

/** A settings file that is not there is simply no settings. */
export function loadConfigFile(path: string): Effect.Effect<FudoConfig, PluginError> {
  return Effect.gen(function* () {
    if (!existsSync(path)) return {}
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(path).text(),
      catch: (cause) => configError('cannot read ' + path + ': ' + String(cause)),
    })
    return yield* parseConfigText(text)
  })
}
