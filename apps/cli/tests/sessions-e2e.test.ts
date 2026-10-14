import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { tier0Plugin } from '@fudo/tools-tier0'
import { tier1Plugin } from '@fudo/tools-tier1'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { main } from '../src/bin.ts'
import { runCommand } from '../src/index.ts'

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const stubLlm = (): Plugin<{}, Llm, never> => ({
  name: 'stub-llm',
  config: Schema.Struct({}),
  provides: [Llm],
  requires: [],
  layer: () =>
    Layer.succeed(Llm, {
      name: 'stub',
      capabilities: {
        toolChoice: false,
        reasoningEffort: null,
        images: 'none',
        promptCacheControl: false,
      },
      stream: () => Stream.fromIterable(textTurn('the notes say twelve files')),
    } satisfies LlmAdapter),
})

/** A profile that keeps its logs where the test can find them. */
const profile = (root: string): string =>
  [
    'name: test',
    'plugins:',
    '  - id: kernel',
    "    name: '@fudo/kernel'",
    '  - id: sessions',
    "    name: '@fudo/session'",
    '  - id: session-jsonl',
    "    name: '@fudo/session-jsonl'",
    '    config:',
    '      root: ' + root,
    '  - id: tools',
    "    name: '@fudo/tools'",
    '  - id: system-prompt',
    "    name: '@fudo/system-prompt'",
    '  - id: safety',
    "    name: '@fudo/safety'",
    '    config:',
    '      preset: full',
    '      sandbox: none',
    '  - id: ask',
    "    name: '@fudo/ask'",
    '  - id: tier0',
    "    name: '@fudo/tools-tier0'",
    '  - id: tier1',
    "    name: '@fudo/tools-tier1'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

/** A settings file whose rows point the sessions at the same place the run wrote them. */
const settingsFile = (root: string): string =>
  [
    'plugins:',
    '  - id: session-jsonl',
    "    name: '@fudo/session-jsonl'",
    '    config:',
    '      root: ' + root,
  ].join('\n') + '\n'

const run = async (
  argv: ReadonlyArray<string>,
): Promise<{ code: number; out: string; err: string }> => {
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

describe('reading the sessions back through the command', () => {
  test('fudo sessions lists what was written, and fudo sessions <id> reads it', async () => {
    const logs = await mkdtemp(join(tmpdir(), 'fudo-sessions-'))
    const home = await mkdtemp(join(tmpdir(), 'fudo-sessions-home-'))
    const settings = join(home, 'config.yaml')
    await writeFile(settings, settingsFile(logs))

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(logs)],
        plugins: [
          kernelPlugin,
          sessionJsonlPlugin,
          sessionPlugin,
          toolsPlugin,
          systemPromptPlugin,
          safetyPlugin,
          askPlugin,
          tier0Plugin,
          tier1Plugin,
          stubLlm(),
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: '/work',
        route: 'stub/model',
        task: 'how many files',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    const listed = await run(['sessions', '--config', settings])
    // The list line starts with the id, then the time and the directory.
    const id = listed.out.split(' ')[0] ?? ''
    const browsed = await run(['sessions', id, '--config', settings])

    // The listing comes from the persistence seam, and names what is on disk.
    expect(listed.code).toBe(0)
    expect(listed.out).toContain('/work')
    expect(id).toHaveLength(36)
    // Reading it back shows the exchange the log folds to.
    expect(browsed.code).toBe(0)
    expect(browsed.out).toContain('session ' + id)
    expect(browsed.out).toContain('[user] how many files')
    expect(browsed.out).toContain('[assistant] the notes say twelve files')

    await rm(logs, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  })

  test('fudo sessions --search finds a session by what it said', async () => {
    const logs = await mkdtemp(join(tmpdir(), 'fudo-sessions-'))
    const home = await mkdtemp(join(tmpdir(), 'fudo-sessions-home-'))
    const settings = join(home, 'config.yaml')
    await writeFile(settings, settingsFile(logs))

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(logs)],
        plugins: [
          kernelPlugin,
          sessionJsonlPlugin,
          sessionPlugin,
          toolsPlugin,
          systemPromptPlugin,
          safetyPlugin,
          askPlugin,
          tier0Plugin,
          tier1Plugin,
          stubLlm(),
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: '/work',
        route: 'stub/model',
        task: 'how many files',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    const found = await run(['sessions', '--search', 'twelve files', '--config', settings])
    const missed = await run(['sessions', '--search', 'no such phrase', '--config', settings])

    expect(found.code).toBe(0)
    expect(found.out).toContain('«twelve files»')
    expect(found.out).toContain('assistant/message')
    expect(missed.out).toBe('no matches\n')

    await rm(logs, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  })

  test('an id that is not there says so', async () => {
    const logs = await mkdtemp(join(tmpdir(), 'fudo-sessions-'))
    const home = await mkdtemp(join(tmpdir(), 'fudo-sessions-home-'))
    const settings = join(home, 'config.yaml')
    await writeFile(settings, settingsFile(logs))

    const missing = await run(['sessions', 'not-a-session', '--config', settings])

    expect(missing.code).toBe(1)
    expect(missing.err).toContain('no session not-a-session')

    await rm(logs, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  })
})
