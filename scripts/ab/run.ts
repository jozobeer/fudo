/**
 * The A/B: the same three tasks, run through fudo and dsh, measured from each
 * harness's own session log — tool calls, failed edits, re-reads, and turns.
 *
 * Run it from the repo root with both harnesses configured:
 *
 *   bun run scripts/ab/run.ts
 *
 * fudo reads its key from ~/.config/fudo/secrets.env on its own. dsh reads the
 * credential store in ~/.dsh, copied into a workspace-local home (a harness
 * session may not write outside its workspace), or a DEEPSEEK_API_KEY in the
 * environment. A harness that cannot answer is reported, not hidden.
 */

import { readFileSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { dshMetrics, fudoMetrics, type AbMetrics } from './metrics.ts'
import { TASKS, type AbTask } from './tasks.ts'

const ROUTE = process.env.FUDO_AB_ROUTE ?? 'ollama-cloud/deepseek-v4.1-flash'
const TIMEOUT_MS = Number(process.env.FUDO_AB_TIMEOUT_MS ?? '300000')
const root = process.cwd()
const abRoot = join(root, '.tmp', 'ab')
const dshHome = join(abRoot, 'dsh-home')
const dshEnv = Object.fromEntries(
  Object.entries(process.env).flatMap(([key, value]) =>
    value === undefined || ['DSH_SESSION_ID', 'DSH_PROFILE', 'DSH_PROFILE_DIR'].includes(key)
      ? []
      : [[key, value]],
  ),
) as Record<string, string>

interface Cell {
  readonly harness: 'fudo' | 'dsh'
  readonly task: string
  readonly code: number | undefined
  readonly done: boolean
  readonly metrics: AbMetrics | undefined
  readonly note: string | undefined
}

/** The newest file under a directory, matching a name and written after `since`. */
const newestFile = async (
  directory: string,
  matches: (name: string) => boolean,
  since: number,
): Promise<string | undefined> => {
  const found: Array<{ path: string; time: number }> = []
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        await walk(child)
        continue
      }
      if (!matches(entry.name)) continue
      const time = (await stat(child)).mtimeMs
      if (time >= since) found.push({ path: child, time })
    }
  }
  await walk(directory)
  return found.sort((left, right) => right.time - left.time)[0]?.path
}

/** The last non-empty line of a harness's output: why it stopped, in its own words. */
const lastLine = (text: string): string =>
  text
    .trim()
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-1)[0]
    ?.slice(0, 240) ?? ''

const jsonl = (text: string): ReadonlyArray<unknown> =>
  text.split('\n').flatMap((line) => {
    if (line.trim() === '') return []
    try {
      return [JSON.parse(line) as unknown]
    } catch {
      return []
    }
  })

/** The dsh log is zstd-compressed; Bun decodes it without a helper process. */
const zstdJsonl = (path: string): ReadonlyArray<unknown> =>
  jsonl(new TextDecoder().decode(Bun.zstdDecompressSync(readFileSync(path))))

const spawn = (
  argv: ReadonlyArray<string>,
  cwd: string,
  env: Record<string, string>,
): { code: number | undefined; output: string } => {
  const run = Bun.spawnSync([...argv], {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  return { code: run.exitCode, output: run.stdout.toString() + run.stderr.toString() }
}

const fudoPatch = (sessions: string): string =>
  [
    'name: ab',
    'plugins:',
    '  - id: session-jsonl',
    "    name: '@fudo/session-jsonl'",
    '    config:',
    '      root: ' + sessions,
    '',
  ].join('\n')

const runFudo = async (task: AbTask, workspace: string, sessions: string): Promise<Cell> => {
  const patch = join(workspace, '.ab-patch.yml')
  await writeFile(patch, fudoPatch(sessions))
  const started = Date.now()
  const { code, output } = spawn(
    [
      'bun',
      join(root, 'apps', 'cli', 'src', 'run.ts'),
      '--patch',
      patch,
      '--model',
      ROUTE,
      task.prompt,
    ],
    workspace,
    process.env as Record<string, string>,
  )
  const log = await newestFile(sessions, (name) => name === 'session.v1.jsonl', started)
  const metrics = log === undefined ? undefined : fudoMetrics(jsonl(await readFile(log, 'utf8')))
  return {
    harness: 'fudo',
    task: task.name,
    code,
    done: await task.done(workspace),
    metrics,
    note:
      metrics === undefined
        ? 'no session log: ' + lastLine(output)
        : code === 0
          ? undefined
          : lastLine(output),
  }
}

const runDsh = async (task: AbTask, workspace: string): Promise<Cell> => {
  const started = Date.now()
  const { code, output } = spawn(['dsh', 'headless', task.prompt], workspace, {
    ...dshEnv,
    DSH_HOME: dshHome,
  })
  const log = await newestFile(
    join(dshHome, 'sessions'),
    (name) => name.endsWith('.jsonl.zstd'),
    started,
  )
  return {
    harness: 'dsh',
    task: task.name,
    code,
    done: await task.done(workspace),
    metrics: log === undefined ? undefined : dshMetrics(zstdJsonl(log)),
    note: code === 0 ? undefined : lastLine(output),
  }
}

const prepare = async (): Promise<void> => {
  await rm(abRoot, { recursive: true, force: true })
  await mkdir(abRoot, { recursive: true })
  const home = join(homedir(), '.dsh')
  await cp(join(home, 'profiles'), join(dshHome, 'profiles'), { recursive: true }).catch(
    () => undefined,
  )
  await cp(join(home, '.credentials.yaml'), join(dshHome, '.credentials.yaml')).catch(
    () => undefined,
  )
  await cp(join(home, '.anonymous-user-id'), join(dshHome, '.anonymous-user-id')).catch(
    () => undefined,
  )
}

const cellOf = async (harness: 'fudo' | 'dsh', task: AbTask): Promise<Cell> => {
  const runRoot = join(abRoot, 'runs', harness + '-' + task.name)
  const workspace = join(runRoot, 'workspace')
  const sessions = join(runRoot, 'sessions')
  await mkdir(workspace, { recursive: true })
  await mkdir(sessions, { recursive: true })
  for (const [path, text] of Object.entries(task.files)) {
    await mkdir(dirname(join(workspace, path)), { recursive: true })
    await writeFile(join(workspace, path), text)
  }
  return harness === 'fudo' ? runFudo(task, workspace, sessions) : runDsh(task, workspace)
}

const cellLine = (cell: Cell): string => {
  const metrics = cell.metrics
  const columns = [
    cell.harness,
    cell.task,
    cell.done ? 'yes' : 'no',
    metrics === undefined ? '-' : String(metrics.toolCalls),
    metrics === undefined ? '-' : String(metrics.failedEdits),
    metrics === undefined ? '-' : String(metrics.reReads),
    metrics === undefined ? '-' : String(metrics.turns),
    cell.code === undefined ? '-' : String(cell.code),
    cell.note ?? '',
  ]
  return '| ' + columns.join(' | ') + ' |'
}

const HARNESSES: ReadonlyArray<'fudo' | 'dsh'> = ['fudo', 'dsh']

await prepare()
const cells: Array<Cell> = []
for (const task of TASKS) {
  for (const harness of HARNESSES) {
    process.stdout.write('running ' + harness + ' on ' + task.name + '...\n')
    cells.push(await cellOf(harness, task))
  }
}

process.stdout.write(
  [
    '| harness | task | done | tool calls | failed edits | re-reads | turns | exit | note |',
    '|---|---|---|---|---|---|---|---|---|',
    ...cells.map(cellLine),
    '',
  ].join('\n'),
)
