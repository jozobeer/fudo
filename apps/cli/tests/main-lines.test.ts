import { describe, expect, test } from 'bun:test'
import { Effect, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { main } from '../src/bin.ts'

const patchWithRoot = async (dir: string): Promise<string> => {
  const path = join(dir, 'sessions.yml')
  await Bun.write(
    path,
    [
      'name: sessions',
      'plugins:',
      '  - id: session-jsonl',
      "    name: '@fudo/session-jsonl'",
      '    config:',
      '      root: ' + join(dir, 'sessions'),
    ].join('\n'),
  )
  return path
}

describe('main with a line stream', () => {
  test('an empty line stream ends the repl with 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fudo-main-'))
    const err: Array<string> = []
    const code = await Effect.runPromise(
      main(['--patch', await patchWithRoot(dir)], {
        stdout: () => undefined,
        stderr: (text) => err.push(text),
        cwd: '/work',
        lines: Stream.make(),
      }),
    )

    expect(code).toBe(0)
    expect(err).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })

  test('without a task and without input there is nothing to do', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fudo-main-'))
    const err: Array<string> = []
    const code = await Effect.runPromise(
      main(['--patch', await patchWithRoot(dir)], {
        stdout: () => undefined,
        stderr: (text) => err.push(text),
        cwd: '/work',
      }),
    )

    expect(code).toBe(2)
    expect(err.join('')).toContain('nothing to do')
    await rm(dir, { recursive: true, force: true })
  })
})
