import { readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

const TYPES: ReadonlyMap<string, string> = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
])

const typeOf = (path: string): string => {
  const index = path.lastIndexOf('.')
  return (index < 0 ? undefined : TYPES.get(path.slice(index))) ?? 'application/octet-stream'
}

/**
 * Resolves a request path inside `root`, or undefined when it escapes it.
 * The check runs after decoding, so `%2e%2e` cannot climb either.
 */
export const staticPath = (root: string, requestPath: string): string | undefined => {
  const decoded = ((): string | undefined => {
    try {
      return decodeURIComponent(requestPath)
    } catch {
      return undefined
    }
  })()
  if (decoded === undefined || decoded.includes('\u0000')) return undefined
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const base = resolve(root)
  const candidate = resolve(join(base, relative))
  return candidate === base || candidate.startsWith(base + sep) ? candidate : undefined
}

/** The file a browser asked for, or undefined when it does not exist. */
export const staticResponse = async (
  root: string,
  requestPath: string,
): Promise<Response | undefined> => {
  const path = staticPath(root, requestPath)
  if (path === undefined) return undefined
  const info = await stat(path).then(
    (value) => value,
    () => undefined,
  )
  if (info === undefined || !info.isFile()) return undefined
  return new Response(await readFile(path), { headers: { 'content-type': typeOf(path) } })
}
