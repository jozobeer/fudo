import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { tier0Plugin } from '@fudo/tools-tier0'
import { mcpPlugin, tier1Plugin } from '@fudo/tools-tier1'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const toolTurn = (name: string, args: unknown): ReadonlyArray<StreamChunk> => [
  {
    type: 'block-end',
    index: 0,
    block: { type: 'tool-call', id: 'c-' + name, name, arguments: JSON.stringify(args) },
  },
  { type: 'finish', kind: 'tool-calls' },
]

const stubLlm = (scripts: ReadonlyArray<ReadonlyArray<StreamChunk>>): Plugin<{}, Llm, never> => {
  let step = 0
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
          const script = scripts[step] ?? textTurn('done')
          step += 1
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

const run = async (
  scripts: ReadonlyArray<ReadonlyArray<StreamChunk>>,
  answer: string,
): Promise<{
  readonly code: number
  readonly settings: string
  readonly printed: string
  readonly results: string
}> => {
  const root = await mkdtemp(join(tmpdir(), 'fudo-plugin-'))
  const home = await mkdtemp(join(tmpdir(), 'fudo-plugin-home-'))
  const settingsPath = join(home, 'config.yaml')
  const printed: Array<string> = []

  const code = await Effect.runPromise(
    runCommand({
      profiles: [profile(root)],
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
        mcpPlugin,
        stubLlm(scripts),
        agentPlugin,
        agentLoopPlugin,
      ] as ReadonlyArray<Plugin<any, any, any>>,
      cwd: '/tmp',
      route: 'stub/model',
      task: 'manage the plugins',
      settingsPath,
      answer: () => Effect.succeed(answer),
      stdout: (text) => {
        printed.push(text)
      },
      stderr: () => undefined,
    }),
  )

  const settings = await readFile(settingsPath, 'utf8').catch(() => '')
  const listed = await Effect.runPromise(jsonlSessions({ root }).list())
  const opened = await Effect.runPromise(jsonlSessions({ root }).open(listed[0]?.id ?? ''))
  const results = opened.events
    .flatMap((event) => (event.type === 'tool/result' ? [JSON.stringify(event.data.content)] : []))
    .join('\n')
  await rm(root, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
  return { code, settings, printed: printed.join(''), results }
}

describe('the plugin rows through the command', () => {
  test('an approved row lands in the settings for the next start', async () => {
    const observed = await run(
      [
        toolTurn('plugin', { action: 'add', id: 'mcp', name: '@fudo/mcp' }),
        toolTurn('plugin', { action: 'list' }),
      ],
      'approve',
    )

    expect(observed.code).toBe(0)
    expect(observed.settings).toContain('id: mcp')
    expect(observed.settings).toContain('@fudo/mcp')
    // The answer says when it takes effect, and this run's rows are unchanged.
    expect(observed.results).toContain('starts again')
    expect(observed.results).toContain('kernel @fudo/kernel')
  })

  test('a row the human keeps changes nothing', async () => {
    const observed = await run(
      [toolTurn('plugin', { action: 'add', id: 'mcp', name: '@fudo/mcp' })],
      'keep the rows as they are',
    )

    expect(observed.code).toBe(0)
    expect(observed.settings).toBe('')
    expect(observed.results).toContain('kept the plugin rows as they are')
  })
})
