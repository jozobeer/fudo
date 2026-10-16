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

/** The rows a profile builds; the block after it names what the run resolved. */
const rowsOf = (text: string): string => text.split('in effect for a run from here:')[0] ?? text

describe('--profile', () => {
  test('the named profile is layered over the base profile', async () => {
    const base = await run(['--dump-config'])
    const repl = await run(['--dump-config', '--profile', 'repl'])

    expect(base.code).toBe(0)
    expect(repl.code).toBe(0)
    // The rows are the same; only the block that says where the name came from differs.
    expect(rowsOf(repl.out)).toBe(rowsOf(base.out))
    expect(repl.out).toContain('id=agent-loop')
    expect(repl.out).toContain('profile: repl — flag (the --profile on the command line)')
    expect(base.out).toContain('profile: headless — default')
  })

  test('the effort flag reaches the dump, and nothing set leaves it to the provider', async () => {
    const flagged = await run(['--dump-config', '--effort', 'high'])
    const plain = await run(['--dump-config'])

    expect(flagged.code).toBe(0)
    expect(flagged.out).toContain(
      'effort in effect: high (--effort > the settings file > a plugin row)',
    )
    expect(flagged.out).toContain('effort: high — flag (the --effort on the command line)')
    expect(plain.out).toContain("effort in effect: the provider's default")
  })

  test('an unknown profile fails with a clear message', async () => {
    const missing = await run(['--dump-config', '--profile', 'nope'])

    expect(missing.code).toBe(1)
    expect(missing.err).toContain('cannot read profile nope')
  })
})
