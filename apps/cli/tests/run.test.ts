import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { interruptOnSignal, linesOf, readChunks, runFudo } from '../src/run.ts'

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

describe('linesOf', () => {
  test('drops the trailing empty line and keeps inner ones', () => {
    expect(linesOf('a\nb\n')).toEqual(['a', 'b'])
    expect(linesOf('a\n\nb')).toEqual(['a', '', 'b'])
    expect(linesOf('')).toEqual([])
  })
})

describe('runFudo', () => {
  test('dump-config needs no input and prints the profile', async () => {
    const out: Array<string> = []
    const code = await Effect.runPromise(
      runFudo(['--dump-config'], {
        stdout: (text) => out.push(text),
        stderr: () => undefined,
        cwd: '/work',
        isTty: true,
        readStdin: async () => '',
      }),
    )

    expect(code).toBe(0)
    expect(out.join('')).toContain('id=agent-loop')
  })

  test('piped input feeds the repl', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fudo-run-'))
    const err: Array<string> = []
    const code = await Effect.runPromise(
      runFudo(['--model', 'test/model', '--patch', await patchWithRoot(dir)], {
        stdout: () => undefined,
        stderr: (text) => err.push(text),
        cwd: '/work',
        isTty: false,
        readStdin: async () => '',
      }),
    )

    expect(code).toBe(0)
    expect(err).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })

  test('accepts an interrupt effect on the task path', async () => {
    const code = await Effect.runPromise(
      runFudo(['--help'], {
        stdout: () => undefined,
        stderr: () => undefined,
        cwd: '/work',
        isTty: true,
        readStdin: async () => '',
        interrupt: Effect.sleep('5 millis'),
      }),
    )

    expect(code).toBe(0)
  })

  test('signals complete the interrupt effect', async () => {
    const code = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.forkScoped(interruptOnSignal())
        yield* Effect.sleep('5 millis')
        yield* Effect.sync(() => {
          process.emit('SIGINT')
        })
        yield* Effect.sleep('5 millis')
        return 0
      }).pipe(Effect.scoped),
    )

    expect(code).toBe(0)
  })

  test('a chunk source reads to a single text', async () => {
    async function* chunks(): AsyncGenerator<Uint8Array | string> {
      yield 'a\n'
      yield new TextEncoder().encode('b\n')
      yield 'c'
    }

    expect(await readChunks(chunks())).toBe('a\nb\nc')
  })
})
