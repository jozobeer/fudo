import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { parseArgs } from '../src/args.ts'
import { main } from '../src/bin.ts'

describe('parseArgs', () => {
  test('collects profile, patches, task, and flags', () => {
    const parsed = parseArgs([
      '--profile',
      'repl',
      '--patch',
      'a.yml',
      '--patch',
      'b.yml',
      '--model',
      'ollama-cloud/kimi-k2.7-code',
      '--json',
      'do',
      'the',
      'thing',
    ])

    expect(parsed.profile).toBe('repl')
    expect(parsed.patches).toEqual(['a.yml', 'b.yml'])
    expect(parsed.model).toBe('ollama-cloud/kimi-k2.7-code')
    expect(parsed.json).toBe(true)
    expect(parsed.task).toBe('do the thing')
    expect(parsed.errors).toEqual([])
  })

  test('reports unknown options and missing values', () => {
    expect(parseArgs(['--nope']).errors).toEqual(['unknown option --nope'])
    expect(parseArgs(['--resume']).errors).toEqual(['--resume needs a value'])
  })

  test('defaults to the headless profile', () => {
    const parsed = parseArgs([])
    expect(parsed.profile).toBe('headless')
    expect(parsed.task).toBeUndefined()
  })
})

describe('main', () => {
  test('--dump-config prints the bundled base profile', async () => {
    const out: Array<string> = []
    const code = await Effect.runPromise(
      main(['--dump-config'], {
        stdout: (text) => out.push(text),
        stderr: () => undefined,
        cwd: '/work',
      }),
    )

    expect(code).toBe(0)
    expect(out.join('')).toContain('id=agent-loop')
    expect(out.join('')).toContain('config={"baseUrl":"https://ollama.com/v1"')
  })
})
