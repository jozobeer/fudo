import { describe, expect, test } from 'bun:test'
import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { replayAdapter } from '@fudo/test-support-replay'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCommand } from '../src/index.ts'

const reply = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

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
    `      root: ${root}`,
    '  - id: tools',
    "    name: '@fudo/tools'",
    '  - id: system-prompt',
    "    name: '@fudo/system-prompt'",
    '  - id: llm',
    '    name: replay-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('replay through the CLI', () => {
  test('the recorded tool calls reach the pipeline and land in the log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-replay-'))
    const sse = await Bun.file(
      new URL('../../../llm/llm-openai/fixtures/ollama-cloud-tool-call.sse', import.meta.url),
    ).text()
    const replayed = replayAdapter(sse)
    let call = 0
    const adapter: LlmAdapter = {
      ...replayed,
      stream: (request) => {
        call += 1
        return call === 1 ? replayed.stream(request) : Stream.fromIterable(reply('done'))
      },
    }
    const replayLlm: Plugin<{}, Llm, never> = {
      name: 'replay-llm',
      config: Schema.Struct({}),
      provides: [Llm],
      requires: [],
      layer: () => Layer.succeed(Llm, adapter),
    }
    const plugins: ReadonlyArray<Plugin<any, any, any>> = [
      kernelPlugin,
      sessionJsonlPlugin,
      sessionPlugin,
      toolsPlugin,
      systemPromptPlugin,
      replayLlm,
      agentPlugin,
      agentLoopPlugin,
    ]

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins,
        cwd: '/work',
        route: 'replay/model',
        task: 'go',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))
    const types = opened.events.map((event) => event.type)
    const assistant = opened.events.find((event) => event.type === 'assistant/message')
    const results = opened.events.filter((event) => event.type === 'tool/result')

    expect(types.filter((type) => type === 'tool/call')).toHaveLength(2)
    expect(results).toHaveLength(2)
    expect(results.every((event) => event.data.isError)).toBe(true)
    expect(types.filter((type) => type === 'turn/start')).toHaveLength(1)
    expect(
      assistant?.type === 'assistant/message'
        ? assistant.data.content.filter((block) => block.type === 'tool-call')
        : [],
    ).toHaveLength(2)
    await rm(root, { recursive: true, force: true })
  })
})
