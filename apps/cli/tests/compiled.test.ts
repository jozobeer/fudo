import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from '@jozo-harness/process'

const root = join(import.meta.dirname, '../../..')
let dir = ''
let binary = ''

const runBinary = async (argv: ReadonlyArray<string>) => {
  const child = spawn([binary, ...argv], {
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
  dir = await mkdtemp(join(tmpdir(), 'jzh-compiled-'))
  binary = join(dir, 'jzh')
  const build = spawn(['pnpm', 'exec', 'vp', '-C', 'apps/cli', 'pack'], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'inherit',
  })
  expect(await build.exited).toBe(0)
  await copyFile(join(root, 'apps/cli/dist/jzh'), binary)
}, 120_000)

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
