import { describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadEnvFrom, parseEnvFile } from '../src/index.ts'
/** Writes a file, making the directories above it, the way Bun.write did. */
const writeFileDeep = async (path: string, text: string | Uint8Array): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

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
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-env-'))
    const nested = join(root, 'a', 'b')
    await mkdir(nested, { recursive: true })
    await writeFileDeep(join(root, '.env'), 'OUTER=outer\nSHARED=outer\n')
    await writeFileDeep(join(nested, '.env'), 'SHARED=inner\nINNER=inner\n')

    const env: Record<string, string | undefined> = { SET_ALREADY: 'keep' }
    loadEnvFrom(nested, env)

    expect(env['SHARED']).toBe('inner')
    expect(env['INNER']).toBe('inner')
    expect(env['OUTER']).toBe('outer')
    expect(env['SET_ALREADY']).toBe('keep')
    await rm(root, { recursive: true, force: true })
  })

  test('never overwrites a variable that is already set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-env-'))
    await writeFileDeep(join(root, '.env'), 'SHARED=from-file\n')

    const env: Record<string, string | undefined> = { SHARED: 'from-shell' }
    loadEnvFrom(root, env)

    expect(env['SHARED']).toBe('from-shell')
    await rm(root, { recursive: true, force: true })
  })
})
