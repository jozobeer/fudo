import { dirname } from 'node:path'
import { Effect, type Scope } from 'effect'
import type { PromptError, PromptSection } from './types.ts'
import type { SystemPromptShape } from './system-prompt.ts'

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

/** Sections built from AGENTS.md files sit after the built-in ones. */
export const AGENTS_MD_ORDER = 900

/**
 * One section per file. The nearest file (index 0) gets the highest order, so
 * joining the rendered prompt puts the most specific instructions last.
 */
export function agentsMdSections(
  files: ReadonlyArray<AgentsFile>,
  order = AGENTS_MD_ORDER,
): ReadonlyArray<PromptSection> {
  return files.map((file, index) => ({
    name: 'agents-md:' + String(index + 1),
    order: order + (files.length - index),
    text: 'Instructions from ' + file.path + ':\n' + file.text.trimEnd(),
  }))
}

/** Registers every AGENTS.md section on the prompt, nearest file last. */
export function registerAgentsMd(
  prompt: SystemPromptShape,
  cwd: string,
): Effect.Effect<void, PromptError, Scope.Scope> {
  return Effect.gen(function* () {
    for (const section of agentsMdSections(yield* loadAgentsFiles(cwd))) {
      yield* prompt.section(section)
    }
  })
}
