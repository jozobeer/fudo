import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { tier0Plugin } from '@fudo/tools-tier0'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const call = (name: string, args: unknown, id: string): StreamChunk => ({
  type: 'block-end',
  index: 0,
  block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) },
})

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const toolTurn = (name: string, args: unknown, id: string): ReadonlyArray<StreamChunk> => [
  call(name, args, id),
  { type: 'finish', kind: 'tool-calls' },
]

const stub = (scripts: ReadonlyArray<ReadonlyArray<StreamChunk>>): Plugin<{}, Llm, never> => {
  let call = 0
  return {
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
        stream: () => {
          const script = scripts[call] ?? []
          call += 1
          return Stream.fromIterable(script)
        },
      } satisfies LlmAdapter),
  }
}

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
    '  - id: tier0',
    "    name: '@fudo/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

const plugins = (llm: Plugin<{}, Llm, never>): ReadonlyArray<Plugin<any, any, any>> => [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  safetyPlugin,
  tier0Plugin,
  llm,
  agentPlugin,
  agentLoopPlugin,
]

const resultsOf = async (root: string) => {
  const listed = await Effect.runPromise(jsonlSessions({ root }).list())
  const opened = await Effect.runPromise(jsonlSessions({ root }).open(listed[0]?.id ?? ''))
  return opened.events.flatMap((event) => (event.type === 'tool/result' ? [event.data] : []))
}

const workspace = async (): Promise<string> => await mkdtemp(join(tmpdir(), 'fugo-guard-ws-'))

describe('writing over a file through the command', () => {
  test('a file the model read may be rewritten in the same session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-guard-'))
    const dir = await workspace()
    await Bun.write(join(dir, 'notes.txt'), 'the original\n')

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins: plugins(
          stub([
            toolTurn('read', { path: 'notes.txt' }, 'c1'),
            toolTurn('write', { path: 'notes.txt', content: 'rewritten\n' }, 'c2'),
            textTurn('done'),
          ]),
        ),
        cwd: dir,
        route: 'stub/model',
        task: 'rewrite the notes',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    expect(await Bun.file(join(dir, 'notes.txt')).text()).toBe('rewritten\n')
    const results = await resultsOf(root)
    expect(results.every((result) => !result.isError)).toBe(true)

    await rm(root, { recursive: true, force: true })
    await rm(dir, { recursive: true, force: true })
  })

  test('a file the model never read is not clobbered', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-guard-'))
    const dir = await workspace()
    await Bun.write(join(dir, 'notes.txt'), 'the original\n')

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins: plugins(
          stub([
            toolTurn('write', { path: 'notes.txt', content: 'clobbered\n' }, 'c1'),
            textTurn('done'),
          ]),
        ),
        cwd: dir,
        route: 'stub/model',
        task: 'rewrite the notes',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    expect(await Bun.file(join(dir, 'notes.txt')).text()).toBe('the original\n')
    const results = await resultsOf(root)
    expect(results[0]?.isError).toBe(true)
    expect(JSON.stringify(results[0]?.content)).toContain('read')

    await rm(root, { recursive: true, force: true })
    await rm(dir, { recursive: true, force: true })
  })
})
