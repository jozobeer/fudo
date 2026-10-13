import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { tier0Plugin } from '@fudo/tools-tier0'
import { toolsPlugin } from '@fudo/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const callRead: ReadonlyArray<StreamChunk> = [
  {
    type: 'block-end',
    index: 0,
    block: { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"path":"notes.txt"}' },
  },
  { type: 'finish', kind: 'tool-calls' },
]

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const stubLlm = (scripts: ReadonlyArray<ReadonlyArray<StreamChunk>>): Plugin<{}, Llm, never> => {
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
    '      preset: workspace-write',
    '  - id: tier0',
    "    name: '@fudo/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('tier 0 through the command', () => {
  test('the model reads a workspace file and the result lands in the log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-tools-'))
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-ws-'))
    await Bun.write(join(workspace, 'notes.txt'), 'hello from the workspace file\n')

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
          tier0Plugin,
          stubLlm([callRead, textTurn('all done')]),
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: workspace,
        route: 'stub/model',
        task: 'summarise notes.txt',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))
    const types = opened.events.map((event) => event.type)
    const assistant = opened.events.find((event) => event.type === 'assistant/message')
    const result = opened.events.find((event) => event.type === 'tool/result')

    expect(types.filter((type) => type === 'tool/call')).toHaveLength(1)
    expect(types).toContain('tool/result')
    expect(
      assistant?.type === 'assistant/message'
        ? assistant.data.content.flatMap((block) =>
            block.type === 'tool-call' ? [block.name] : [],
          )
        : [],
    ).toEqual(['read'])
    expect(result?.type === 'tool/result' ? result.data.isError : true).toBe(false)
    expect(JSON.stringify(result)).toContain('hello from the workspace file')
    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })
})
