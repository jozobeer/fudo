import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const entry = join(import.meta.dir, '../src/run.ts')
let dir = ''
let binary = ''

const runBinary = async (argv: ReadonlyArray<string>) => {
  const child = Bun.spawn([binary, ...argv], {
    cwd: dir,
    env: { ...process.env, XDG_CONFIG_HOME: dir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, out, err }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fudo-compiled-'))
  binary = join(dir, 'fudo')
  const build = Bun.spawn([process.execPath, 'build', '--compile', entry, '--outfile', binary], {
    stdout: 'ignore',
    stderr: 'inherit',
  })
  expect(await build.exited).toBe(0)
}, 60_000)

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('compiled binary', () => {
  test('dump-config reads the profiles embedded in the binary', async () => {
    const base = await runBinary(['--dump-config'])
    const repl = await runBinary(['--dump-config', '--profile', 'repl'])

    expect(base).toMatchObject({ code: 0, err: '' })
    expect(base.out).toContain('id=agent-loop')
    // The rows match; the block that names the resolved profile is meant to differ.
    const rowsOf = (text: string): string => text.split('in effect for a run from here:')[0] ?? text
    expect(rowsOf(repl.out)).toBe(rowsOf(base.out))
  })
})
