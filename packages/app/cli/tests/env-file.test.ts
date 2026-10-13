import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadEnvFrom, parseEnvFile } from '../src/index.ts'

describe('parseEnvFile', () => {
  test('reads keys, quotes, comments, and skips junk', () => {
    expect(
      parseEnvFile(
        ['# comment', '', 'A=1', 'B="two words"', "C='three'", 'not a line', '=x', 'D='].join('\n'),
      ),
    ).toEqual([
      ['A', '1'],
      ['B', 'two words'],
      ['C', 'three'],
      ['D', ''],
    ])
  })
})

describe('loadEnvFrom', () => {
  test('fills what the environment lacks, nearest file winning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-env-'))
    const nested = join(root, 'a', 'b')
    await mkdir(nested, { recursive: true })
    await Bun.write(join(root, '.env'), 'OUTER=outer\nSHARED=outer\n')
    await Bun.write(join(nested, '.env'), 'SHARED=inner\nINNER=inner\n')

    const env: Record<string, string | undefined> = { SET_ALREADY: 'keep' }
    loadEnvFrom(nested, env)

    expect(env['SHARED']).toBe('inner')
    expect(env['INNER']).toBe('inner')
    expect(env['OUTER']).toBe('outer')
    expect(env['SET_ALREADY']).toBe('keep')
    await rm(root, { recursive: true, force: true })
  })

  test('never overwrites a variable that is already set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-env-'))
    await Bun.write(join(root, '.env'), 'SHARED=from-file\n')

    const env: Record<string, string | undefined> = { SHARED: 'from-shell' }
    loadEnvFrom(root, env)

    expect(env['SHARED']).toBe('from-shell')
    await rm(root, { recursive: true, force: true })
  })
})
