/**
 * The coverage gate: runs the suite with an lcov report and fails when the
 * totals fall under the floors below. The comparison lives here, beside the
 * numbers, so a failure can name the metric that fell below.
 */

/** The percentages the suite may not fall under. */
const FLOOR = { lines: 93, functions: 92 } as const

/** A running tally; the fields are mutated as the lcov report is read. */
interface Totals {
  lines: { hit: number; found: number }
  functions: { hit: number; found: number }
}

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { mkdtemp, readFile, readdir, rm } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')

/** Where the workspace keeps the binaries of its own dependencies. */
const BIN = join(fileURLToPath(new URL('..', import.meta.url)), 'node_modules', '.bin')

const directory = await mkdtemp(join(tmpdir(), 'jozo-harness-coverage-'))
const run = spawnSync(
  join(BIN, 'vp'),
  ['test', '--coverage', '--coverage.reporter=lcov', '--coverage.reportsDirectory', directory],
  { stdio: 'inherit', cwd: process.cwd() },
)
if (run.status !== 0) {
  await rm(directory, { recursive: true, force: true })
  process.exit(run.status ?? 1)
}

const totals: Totals = {
  lines: { hit: 0, found: 0 },
  functions: { hit: 0, found: 0 },
}
for (const name of await readdir(directory)) {
  if (!name.endsWith('.info')) continue
  for (const line of (await readFile(join(directory, name), 'utf8')).split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const key = line.slice(0, separator)
    const value = Number(line.slice(separator + 1))
    if (!Number.isFinite(value)) continue
    if (key === 'LF') totals.lines.found += value
    if (key === 'LH') totals.lines.hit += value
    if (key === 'FNF') totals.functions.found += value
    if (key === 'FNH') totals.functions.hit += value
  }
}
await rm(directory, { recursive: true, force: true })

const percent = (part: number, whole: number): number => (whole === 0 ? 100 : (part / whole) * 100)

const summary: ReadonlyArray<readonly [name: 'lines' | 'functions', value: number]> = [
  ['lines', percent(totals.lines.hit, totals.lines.found)],
  ['functions', percent(totals.functions.hit, totals.functions.found)],
]
const short = summary.filter(([name, value]) => value < FLOOR[name])

for (const [name, value] of summary) {
  process.stdout.write(
    'coverage ' + name + ': ' + value.toFixed(2) + '% (floor ' + String(FLOOR[name]) + '%)\n',
  )
}
if (short.length > 0) {
  process.stderr.write(
    'jzh: coverage fell below the floor: ' +
      short.map(([name]) => name).join(', ') +
      '; add a test or lower the floor in scripts/coverage-gate.ts\n',
  )
  process.exit(1)
}
