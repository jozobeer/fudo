import { statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { listSecrets, removeSecret, writeSecret } from '../src/index.ts'

const withFile = async (body?: string) => {
  const directory = await mkdtemp(join(tmpdir(), 'fudo-secret-file-'))
  const path = join(directory, 'secrets.env')
  if (body !== undefined) await Bun.write(path, body)
  return { directory, path }
}

describe('writeSecret', () => {
  test('creates the file with 600 and one line', async () => {
    const { directory, path } = await withFile()

    writeSecret(path, 'OLLAMA_API_KEY', 'secret-value')

    expect(await Bun.file(path).text()).toBe('OLLAMA_API_KEY=secret-value\n')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    await rm(directory, { recursive: true, force: true })
  })

  test('replaces a value in place and keeps comments', async () => {
    const { directory, path } = await withFile('# my keys\nA=1\nB=2\n')

    writeSecret(path, 'A', 'updated')

    expect(await Bun.file(path).text()).toBe('# my keys\nA=updated\nB=2\n')
    await rm(directory, { recursive: true, force: true })
  })
})

describe('listSecrets and removeSecret', () => {
  test('lists names only and removes one', async () => {
    const { directory, path } = await withFile('A=1\nB=2\n')

    expect(listSecrets(path)).toEqual(['A', 'B'])
    expect(removeSecret(path, 'A')).toBe(true)
    expect(listSecrets(path)).toEqual(['B'])
    expect(removeSecret(path, 'missing')).toBe(false)
    await rm(directory, { recursive: true, force: true })
  })
})
