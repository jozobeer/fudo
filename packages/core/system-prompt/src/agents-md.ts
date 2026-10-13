import { dirname } from 'node:path'
import { Effect } from 'effect'

export interface AgentsFile {
  /** Absolute path of the file that was read. */
  readonly path: string
  readonly text: string
}

const readIfPresent = (path: string): Effect.Effect<AgentsFile | undefined> =>
  Effect.gen(function* () {
    const file = Bun.file(path)
    const exists = yield* Effect.promise(() => file.exists())
    if (!exists) return undefined
    const text = yield* Effect.promise(() => file.text())
    return { path, text }
  })

/**
 * Reads AGENTS.md from \`cwd\` upward through its ancestors. The nearest file
 * comes first, so a later join puts the most specific instruction last.
 */
export function loadAgentsFiles(cwd: string): Effect.Effect<ReadonlyArray<AgentsFile>> {
  return Effect.gen(function* () {
    const found: Array<AgentsFile> = []
    let directory = cwd
    while (true) {
      const file = yield* readIfPresent(directory + '/AGENTS.md')
      if (file !== undefined) found.push(file)
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    return found
  })
}
