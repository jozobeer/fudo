import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Parses dotenv text: comments, blanks, optional quotes, no expansion. */
export function parseEnvFile(text: string): ReadonlyArray<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const equals = line.indexOf('=')
    if (equals <= 0) continue
    const key = line.slice(0, equals).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(equals + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    entries.push([key, value])
  }
  return entries
}

/**
 * Reads the nearest .env at or above the given directory and fills variables
 * that are not set yet. The process environment always wins.
 */
export function loadEnvFrom(
  directory: string,
  env: Record<string, string | undefined> = process.env,
): ReadonlyArray<string> {
  const chain: Array<string> = []
  let current = directory
  while (true) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const loaded: Array<string> = []
  const fromFiles = new Set<string>()
  // Farthest first, so a nearer file overrides an outer one.
  for (const folder of chain.reverse()) {
    const path = join(folder, '.env')
    if (!existsSync(path)) continue
    for (const [key, value] of parseEnvFile(readFileSync(path, 'utf8'))) {
      const present = env[key]
      const fromShell = present !== undefined && present !== '' && !fromFiles.has(key)
      if (fromShell) continue
      env[key] = value
      fromFiles.add(key)
      loaded.push(key)
    }
  }
  return loaded
}
