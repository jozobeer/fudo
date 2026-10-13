import { statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runAuth, type AuthIo } from '../src/index.ts'

const collector = (value: string): { io: AuthIo; out: Array<string>; err: Array<string> } => {
  const out: Array<string> = []
  const err: Array<string> = []
  return {
    out,
    err,
    io: {
      stdout: (text) => void out.push(text),
      stderr: (text) => void err.push(text),
      readLine: async () => value,
    },
  }
}

const withXdg = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fudo-auth-'))
  return { directory, env: { XDG_CONFIG_HOME: directory } }
}

describe('fudo auth', () => {
  test('set stores the value and never prints it', async () => {
    const { directory, env } = await withXdg()
    const { io, out } = collector('secret-value')

    const code = await runAuth(['set', 'OLLAMA_API_KEY'], io, env)

    const path = join(directory, 'fudo', 'secrets.env')
    expect(code).toBe(0)
    expect(await Bun.file(path).text()).toBe('OLLAMA_API_KEY=secret-value\n')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(out.join('')).toContain('stored OLLAMA_API_KEY')
    expect(out.join('')).not.toContain('secret-value')
    await rm(directory, { recursive: true, force: true })
  })

  test('set refuses when there is nothing to read', async () => {
    const { directory, env } = await withXdg()
    const { io, err } = collector('   ')

    const code = await runAuth(['set', 'API_KEY'], io, env)

    expect(code).toBe(2)
    expect(err.join('')).toContain('nothing was read')
    await rm(directory, { recursive: true, force: true })
  })

  test('list shows names and remove deletes one', async () => {
    const { directory, env } = await withXdg()
    await runAuth(['set', 'A_KEY'], collector('one').io, env)
    await runAuth(['set', 'B_KEY'], collector('two').io, env)

    const list = collector('')
    expect(await runAuth(['list'], list.io, env)).toBe(0)
    expect(list.out.join('')).toBe('A_KEY\nB_KEY\n')

    const remove = collector('')
    expect(await runAuth(['remove', 'A_KEY'], remove.io, env)).toBe(0)
    expect(remove.out.join('')).toContain('removed A_KEY')

    const again = collector('')
    expect(await runAuth(['remove', 'A_KEY'], again.io, env)).toBe(1)
    await rm(directory, { recursive: true, force: true })
  })

  test('a bad name only prints usage', async () => {
    const { directory, env } = await withXdg()
    const { io, err } = collector('x')

    expect(await runAuth(['set', 'bad name'], io, env)).toBe(2)
    expect(err.join('')).toContain('fudo auth set NAME')
    await rm(directory, { recursive: true, force: true })
  })
})
