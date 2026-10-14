import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * One event of a session, in the shape any log has: a sequence number, a time, a
 * type, and its data. The harness reads a log without depending on who wrote it.
 */
export interface LoggedEvent {
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: unknown
}

/** One recorded session: what the model said, what was asked, and what was there. */
export interface Scenario {
  readonly name: string
  /** The assistant streams to serve, one per request, as recorded SSE. */
  readonly streams: ReadonlyArray<string>
  /** The one-shot task, or the lines a batch run is fed instead. */
  readonly task?: string
  readonly lines?: ReadonlyArray<string>
  /** Files the workspace starts with, keyed by a path relative to it. */
  readonly files?: Readonly<Record<string, string>>
  /** How an approval request is answered; undefined refuses, like a run with nobody there. */
  readonly approve?: boolean
}

/** What one replay needs from whoever owns the CLI: a place, a log, and the plugins. */
export interface ScenarioRun {
  readonly workspace: string
  readonly logs: string
  readonly streams: ReadonlyArray<string>
  readonly approve: boolean | undefined
  readonly task: string | undefined
  readonly lines: ReadonlyArray<string> | undefined
}

/** Runs one session the way the CLI does, and answers with its log. */
export type ScenarioRunner = (
  run: ScenarioRun,
) => Promise<{ readonly code: number; readonly events: ReadonlyArray<LoggedEvent> }>

/** What one replay left behind, ready to compare with a recording. */
export interface ScenarioOutcome {
  readonly name: string
  readonly code: number
  /** The log and the workspace, with ids, times, and temp paths written as tokens. */
  readonly snapshot: string
  readonly events: ReadonlyArray<LoggedEvent>
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
/** An instant written the way the runtime context says it: it moves between runs. */
const INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g

const replaced = (text: string, tokens: ReadonlyArray<readonly [string, string]>): string =>
  tokens
    .reduce((current, [value, token]) => current.split(value).join(token), text)
    .replace(UUID, '<uuid>')
    .replace(INSTANT, '<time>')

/** The fields that change every run, wherever they sit in an event. */
const UNSTABLE = /^(time\d*|dt|duration|createdAt|mtimeMs|startedAt|firedAt)$/

const scrub = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(scrub)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      // Only a number can be a moment that moves between runs. A field named
      // `time` inside a tool schema is a schema; zeroing it would hide it.
      UNSTABLE.test(key) && typeof inner === 'number' ? 0 : scrub(inner),
    ]),
  )
}

const withoutTime = (event: LoggedEvent): unknown => ({
  ...event,
  time: 0,
  data: scrub(event.data),
})

/** The log as one line per event, with what changes every run written as tokens. */
export const normalizeLog = (
  events: ReadonlyArray<LoggedEvent>,
  tokens: ReadonlyArray<readonly [string, string]>,
): string => events.map((event) => replaced(JSON.stringify(withoutTime(event)), tokens)).join('\n')

/** Every file under a directory, as path and text, sorted so two runs compare. */
export const readTree = async (root: string): Promise<ReadonlyArray<readonly [string, string]>> => {
  const found: Array<readonly [string, string]> = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      found.push([relative(root, path).split(sep).join('/'), await readFile(path, 'utf8')])
    }
  }
  await walk(root)
  return found.sort(([left], [right]) => left.localeCompare(right))
}

/** The first line two texts disagree on, in the words of a diff. */
export const firstDifference = (recorded: string, replayed: string): string | undefined => {
  const before = recorded.split('\n')
  const after = replayed.split('\n')
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if (before[index] !== after[index]) {
      return (
        'line ' +
        String(index + 1) +
        ':\n  recorded: ' +
        String(before[index]) +
        '\n  replayed: ' +
        String(after[index])
      )
    }
  }
  return undefined
}

/**
 * Replays one recording through whatever the caller runs. The workspace and the log
 * live in fresh temp directories, so a run neither reads nor writes anything real,
 * and the snapshot it answers with has every unstable part written as a token.
 */
export const runScenario = async (
  scenario: Scenario,
  runner: ScenarioRunner,
): Promise<ScenarioOutcome> => {
  const base = await mkdtemp(join(tmpdir(), 'fudo-scenario-'))
  const workspace = join(base, 'workspace')
  const logs = join(base, 'logs')
  await mkdir(workspace, { recursive: true })
  await mkdir(logs, { recursive: true })
  for (const [path, text] of Object.entries(scenario.files ?? {})) {
    await mkdir(dirname(join(workspace, path)), { recursive: true })
    await writeFile(join(workspace, path), text)
  }
  try {
    const { code, events } = await runner({
      workspace,
      logs,
      streams: scenario.streams,
      approve: scenario.approve,
      task: scenario.task,
      lines: scenario.lines,
    })
    // The longest paths first: a shorter one would leave its own name behind.
    const tokens: ReadonlyArray<readonly [string, string]> = [
      [workspace, '<workspace>'],
      [logs, '<logs>'],
      [base, '<tmp>'],
      [tmpdir(), '<tmpdir>'],
    ]
    const files = await readTree(workspace)
    return {
      name: scenario.name,
      code,
      events,
      snapshot:
        'exit ' +
        String(code) +
        '\n' +
        normalizeLog(events, tokens) +
        '\n--- workspace ---\n' +
        files.map(([path, text]) => path + '\n' + text).join('\n'),
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}
