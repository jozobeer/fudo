import { lstatSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Effect } from 'effect'
import { ToolError } from '@jozo-harness/tools'

/**
 * The one place a path becomes a path a tool may use. Everything that writes, or
 * runs somewhere, goes through here: a path is taken only when it stays under the
 * workspace and goes through no link, because a link would let the work out while
 * the path still reads as if it stayed inside.
 */
export const resolveInside = (root: string, path: string): Effect.Effect<string, ToolError> => {
  const target = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const inside = relative(root, target)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    return Effect.fail(
      new ToolError({ code: 'denied', message: 'path escapes the workspace: ' + path }),
    )
  }
  const linked = linkIn(root, inside)
  if (linked !== undefined) {
    return Effect.fail(
      new ToolError({
        code: 'denied',
        message: path + ' goes through a link: ' + linked + '; write the path it points to instead',
      }),
    )
  }
  return Effect.succeed(target)
}

/** The first component below the root that is a link, if any. Parts that are not there yet are new work. */
const linkIn = (root: string, inside: string): string | undefined => {
  let walk = root
  for (const part of inside.split(sep)) {
    walk = join(walk, part)
    const info = lstatSync(walk, { throwIfNoEntry: false })
    if (info === undefined) return undefined
    if (info.isSymbolicLink()) return walk
  }
  return undefined
}
