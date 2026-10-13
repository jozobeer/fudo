import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseEnvFile } from './env-file.ts'

export interface ConfigPaths {
  readonly directory: string
  readonly config: string
  readonly secrets: string
}

/** Where fudo keeps its settings: XDG first, then ~/.config. */
export const configPaths = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConfigPaths => {
  const base = env['XDG_CONFIG_HOME']
  const directory =
    base !== undefined && base !== '' ? join(base, 'fudo') : join(homedir(), '.config', 'fudo')
  return {
    directory,
    config: join(directory, 'config.yaml'),
    secrets: join(directory, 'secrets.env'),
  }
}

const isTooOpen = (path: string): boolean => {
  const mode = statSync(path).mode & 0o777
  return (mode & 0o077) !== 0
}

/**
 * Fills the environment from the secrets file, which is kept apart from the
 * settings so it can stay unreadable and out of version control. A file the
 * user or group can read is reported, because the secrets would be readable
 * without permission.
 */
export function loadSecrets(
  path: string,
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = () => undefined,
): ReadonlyArray<string> {
  if (!existsSync(path)) return []
  if (isTooOpen(path)) {
    warn('fudo: ' + path + ' is readable by others; run: chmod 600 ' + path + '\n')
  }
  const loaded: Array<string> = []
  for (const [key, value] of parseEnvFile(readFileSync(path, 'utf8'))) {
    const present = env[key]
    if (present !== undefined && present !== '') continue
    env[key] = value
    loaded.push(key)
  }
  return loaded
}
