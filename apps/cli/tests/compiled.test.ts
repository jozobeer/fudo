import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from '@jozo-harness/process'

const root = join(import.meta.dirname, '../../..')
let dir = ''
let binary = ''
let patch = ''

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

/** The url the server reports on stderr, as it starts. */
const urlFrom = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value !== undefined) text += decoder.decode(value)
    const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)
    if (match !== null) return match[0]
  }
  throw new Error('the web server never reported a url: ' + text)
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jzh-compiled-'))
  binary = join(dir, 'jzh')
  // The page rides in the binary when it has been built first.
  const web = spawn(['pnpm', 'run', 'build:web'], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'inherit',
  })
  expect(await web.exited).toBe(0)
  const build = spawn(['pnpm', 'exec', 'vp', '-C', 'apps/cli', 'pack'], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'inherit',
  })
  expect(await build.exited).toBe(0)
  await copyFile(join(root, 'apps/cli/dist/jzh'), binary)
  patch = join(dir, 'sessions.yml')
  await writeFile(
    patch,
    [
      'name: sessions',
      'plugins:',
      '  - id: session-jsonl',
      "    name: '@jozo-harness/session-jsonl'",
      '    config:',
      '      root: ' + join(dir, 'sessions'),
    ].join('\n'),
  )
}, 180_000)

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

  test('web serves the page embedded in the binary', async () => {
    const child = spawn([binary, 'web', '--port', '0', '--model', 'stub/model', '--patch', patch], {
      cwd: dir,
      env: { ...process.env, XDG_CONFIG_HOME: dir },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    try {
      const url = await urlFrom(child.stderr)
      const page = await fetch(url)
      const script = await fetch(url + 'main.js')

      expect(page.status).toBe(200)
      expect(await page.text()).toContain('<title>jozo-harness</title>')
      expect(script.status).toBe(200)
    } finally {
      child.kill()
      await child.exited
    }
  }, 30_000)
})
