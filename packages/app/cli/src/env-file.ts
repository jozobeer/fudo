import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Drops one pair of matching quotes, so values can hold spaces. */
const unquote = (value: string): string => {
  if (value.length <= 1) return value
  const quote = value[0]
  return (quote === '"' || quote === "'") && value.endsWith(quote) ? value.slice(1, -1) : value
}

/** One dotenv line; comments, blanks, and malformed lines become undefined. */
const parseLine = (raw: string): readonly [string, string] | undefined => {
  const line = raw.trim()
  if (line === '' || line.startsWith('#')) return undefined
  const equals = line.indexOf('=')
  if (equals <= 0) return undefined
  const key = line.slice(0, equals).trim()
  if (!KEY.test(key)) return undefined
  return [key, unquote(line.slice(equals + 1).trim())]
}

/** Parses dotenv text: comments, blanks, optional quotes, no expansion. */
export function parseEnvFile(text: string): ReadonlyArray<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = []
  for (const raw of text.split('\n')) {
    const entry = parseLine(raw)
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

/** Every directory from the given one up to the filesystem root. */
const ancestorChain = (directory: string): Array<string> => {
  const chain: Array<string> = []
  let current = directory
  while (true) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) return chain
    current = parent
  }
}

/** Fills one .env into the environment; the shell and nearer files win. */
const fillFromFile = (
  path: string,
  env: Record<string, string | undefined>,
  fromFiles: Set<string>,
  loaded: Array<string>,
): void => {
  for (const [key, value] of parseEnvFile(readFileSync(path, 'utf8'))) {
    const present = env[key]
    const fromShell = present !== undefined && present !== '' && !fromFiles.has(key)
    if (fromShell) continue
    env[key] = value
    fromFiles.add(key)
    loaded.push(key)
  }
}

/**
 * Reads the nearest .env at or above the given directory and fills variables
 * that are not set yet. The process environment always wins.
 */
export function loadEnvFrom(
  directory: string,
  env: Record<string, string | undefined> = process.env,
): ReadonlyArray<string> {
  const loaded: Array<string> = []
  const fromFiles = new Set<string>()
  // Farthest first, so a nearer file overrides an outer one.
  for (const folder of ancestorChain(directory).reverse()) {
    const path = join(folder, '.env')
    if (existsSync(path)) fillFromFile(path, env, fromFiles, loaded)
  }
  return loaded
}
