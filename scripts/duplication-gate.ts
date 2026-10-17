/**
 * The duplication gate: production sources and scripts may not repeat each
 * other in runs of 70 tokens or more. Tests are left out on purpose — e2e
 * scaffolding is meant to look alike, and a gate that forbids it would only
 * teach people to hide it.
 *
 * jscpd is a pinned devDependency, run from the workspace's own bin. The exit
 * code is not trusted; the clone count in the report is.
 */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the workspace keeps the binaries of its own dependencies. */
const BIN = join(fileURLToPath(new URL('..', import.meta.url)), 'node_modules', '.bin')

const MIN_TOKENS = '70'
const MIN_LINES = '12'
/** Directories, not globs: jscpd walks a directory but does not expand a glob. */
const PATTERNS = ['packages', 'apps', 'scripts'] as const
const FORMATS = 'typescript,javascript'
const IGNORE =
  '**/node_modules/**,**/dist/**,**/.tmp/**,**/tests/**,**/fixtures/**,**/*.test.ts,**/*.spec.ts'

const run = spawnSync(
  join(BIN, 'jscpd'),
  [
    '--min-tokens',
    MIN_TOKENS,
    '--min-lines',
    MIN_LINES,
    '--ignore',
    IGNORE,
    '--format',
    FORMATS,
    '--reporters',
    'console',
    ...PATTERNS,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() },
)

// Built from the code point: a literal escape character trips the linter.
const ansi = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const report = ((run.stdout?.toString() ?? '') + (run.stderr?.toString() ?? '')).replace(ansi, '')
const found = /Found (\d+) clones?\./.exec(report)
if (found === null) {
  process.stderr.write('jzh: the duplication gate could not run jscpd; is the network up?\n')
  process.stderr.write(report.slice(-2000))
  process.exit(1)
}

const clones = Number(found[1])
if (clones > 0) {
  process.stderr.write(
    'jzh: ' +
      String(clones) +
      ' duplicated runs of ' +
      MIN_LINES +
      '+ lines in production sources:\n',
  )
  process.stderr.write(report.slice(0, 6000))
  process.exit(1)
}
process.stdout.write(
  'duplication: no repeated run of ' + MIN_LINES + '+ lines in production sources\n',
)
