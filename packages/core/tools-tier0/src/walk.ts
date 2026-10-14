import { readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { Effect } from 'effect'

/** Directories that hold other people's code; a search never walks into them. */
export const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set(['.git', 'node_modules'])
/** How much of a file is sniffed for a NUL byte when deciding whether it is binary. */
export const BINARY_SNIFF_BYTES = 8192

/** One rule of a gitignore-like file. */
export interface IgnoreRule {
  readonly negated: boolean
  /** The rule speaks only for directories. */
  readonly directoryOnly: boolean
  /** The rule is relative to the workspace root rather than matching at any depth. */
  readonly anchored: boolean
  readonly pattern: string
}

const REGEX_SPECIALS = /[.+^${}()|[\]\\]/g

/** The regular expression one rule uses, in the gitignore subset this walker honours. */
const ruleExpression = (rule: IgnoreRule): RegExp => {
  const body = rule.pattern
    .replace(REGEX_SPECIALS, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
  const anywhere = rule.anchored ? '' : '(?:^|.*/)'
  return new RegExp(anywhere + body + '(?:/.*)?$')
}

const parseRule = (line: string): IgnoreRule | undefined => {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return undefined
  const negated = trimmed.startsWith('!')
  const marked = negated ? trimmed.slice(1) : trimmed
  const directoryOnly = marked.endsWith('/')
  const raw = directoryOnly ? marked.slice(0, -1) : marked
  const anywhere = raw.startsWith('**/')
  const pattern = anywhere ? raw.slice(3) : raw
  const anchored = !anywhere && (raw.startsWith('/') || pattern.includes('/'))
  return { negated, directoryOnly, anchored, pattern }
}

/** The ignore files one workspace may carry, read in the order they win. */
const IGNORE_FILES = ['.gitignore', '.ignore'] as const

const textIfPresent = (path: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.promise(() =>
    Bun.file(path)
      .text()
      .then((text) => text.split('\n'))
      .catch(() => []),
  )

/** The rules the workspace root states; nested ignore files are not read. */
export const readIgnoreRules = (cwd: string): Effect.Effect<ReadonlyArray<IgnoreRule>> =>
  Effect.gen(function* () {
    const rules: Array<IgnoreRule> = []
    for (const name of IGNORE_FILES) {
      for (const line of yield* textIfPresent(join(cwd, name))) {
        const rule = parseRule(line)
        if (rule !== undefined) rules.push(rule)
      }
    }
    return rules
  })

export interface IgnoredPaths {
  /** Whether the workspace-relative path is excluded; the last matching rule wins. */
  ignores(relativePath: string, isDirectory: boolean): boolean
}

/** Prepares the rules for many lookups. */
export const makeIgnoredPaths = (rules: ReadonlyArray<IgnoreRule>): IgnoredPaths => {
  const compiled = rules.map((rule) => ({ rule, expression: ruleExpression(rule) }))
  return {
    ignores: (relativePath, isDirectory) => {
      let ignored = false
      for (const { rule, expression } of compiled) {
        if (rule.directoryOnly && !isDirectory) continue
        if (expression.test(relativePath)) ignored = !rule.negated
      }
      return ignored
    },
  }
}

/** Whether a file's head looks like binary data rather than text. */
export const isBinary = (bytes: Uint8Array): boolean =>
  bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)

export interface WalkRequest {
  readonly cwd: string
  /** The most paths to collect; the walk stops there. */
  readonly limit: number
  /** When given, only files whose workspace-relative path matches are collected. */
  readonly pattern?: string
}

interface Walk {
  readonly limit: number
  readonly glob: Bun.Glob | undefined
  readonly ignored: IgnoredPaths
  readonly found: Array<string>
}

const readEntries = (directory: string) =>
  Effect.promise(() =>
    readdir(directory, { withFileTypes: true }).then(
      (entries) => entries,
      () => [],
    ),
  )

const skipDirectory = (walk: Walk, name: string, relative: string): boolean =>
  IGNORED_DIRECTORIES.has(name) || walk.ignored.ignores(relative, true)

const acceptsFile = (walk: Walk, relative: string): boolean =>
  !walk.ignored.ignores(relative, false) && (walk.glob === undefined || walk.glob.match(relative))

const relativeOf = (prefix: string, name: string): string =>
  prefix === '' ? name : prefix + '/' + name

/** Descends into one entry, or collects it when it is a file the rules let through. */
const takeEntry = (
  walk: Walk,
  directory: string,
  prefix: string,
  entry: Dirent,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const relative = relativeOf(prefix, entry.name)
    if (entry.isDirectory()) {
      if (!skipDirectory(walk, entry.name, relative)) {
        yield* collectFrom(walk, join(directory, entry.name), relative)
      }
      return
    }
    if (entry.isFile() && acceptsFile(walk, relative)) walk.found.push(relative)
  })

/** Hidden entries are skipped, as a search tool conventionally does. */
const collectFrom = (walk: Walk, directory: string, prefix: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const entry of yield* readEntries(directory)) {
      if (walk.found.length >= walk.limit) return
      if (!entry.name.startsWith('.')) yield* takeEntry(walk, directory, prefix, entry)
    }
  })

/**
 * Every file under `cwd` that survives the ignore files, sorted by path. A path
 * that is a directory the rules exclude is never walked, so its contents cost
 * nothing; hidden entries are skipped; the walk stops at `limit`.
 */
export const walkFiles = (request: WalkRequest): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const walk: Walk = {
      limit: request.limit,
      glob: request.pattern === undefined ? undefined : new Bun.Glob(request.pattern),
      ignored: makeIgnoredPaths(yield* readIgnoreRules(request.cwd)),
      found: [],
    }
    yield* collectFrom(walk, request.cwd, '')
    walk.found.sort()
    return walk.found
  })
