/**
 * The coverage gate: runs the suite with an lcov report and fails when the
 * totals fall under the floors below. Bun 1.4.3 reads `coverageThreshold` from
 * bunfig.toml and then fails every run without a word, so the comparison lives
 * here, where it can also say which metric fell below.
 */

/** The percentages the suite may not fall under. */
const FLOOR = { lines: 93, functions: 92 } as const

interface Totals {
  readonly lines: { readonly hit: number; readonly found: number }
  readonly functions: { readonly hit: number; readonly found: number }
}

const { mkdtemp, readFile, readdir, rm } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

const directory = await mkdtemp(join(tmpdir(), 'fudo-coverage-'))
const run = Bun.spawnSync(
  ['bun', 'test', '--coverage', '--coverage-reporter=lcov', '--coverage-dir', directory],
  { stdio: ['inherit', 'inherit', 'inherit'], cwd: process.cwd() },
)
if (run.exitCode !== 0) {
  await rm(directory, { recursive: true, force: true })
  process.exit(run.exitCode ?? 1)
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
    'fudo: coverage fell below the floor: ' +
      short.map(([name]) => name).join(', ') +
      '; add a test or lower the floor in scripts/coverage-gate.ts\n',
  )
  process.exit(1)
}
