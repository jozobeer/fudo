import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { main } from '../src/bin.ts'

const run = async (argv: ReadonlyArray<string>) => {
  const out: Array<string> = []
  const err: Array<string> = []
  const code = await Effect.runPromise(
    main(argv, {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      cwd: '/work',
    }),
  )
  return { code, out: out.join(''), err: err.join('') }
}

describe('--profile', () => {
  test('the named profile is layered over the base profile', async () => {
    const base = await run(['--dump-config'])
    const repl = await run(['--dump-config', '--profile', 'repl'])

    expect(base.code).toBe(0)
    expect(repl.code).toBe(0)
    expect(repl.out).toBe(base.out)
    expect(repl.out).toContain('id=agent-loop')
  })

  test('an unknown profile fails with a clear message', async () => {
    const missing = await run(['--dump-config', '--profile', 'nope'])

    expect(missing.code).toBe(1)
    expect(missing.err).toContain('cannot read profile nope')
  })
})
