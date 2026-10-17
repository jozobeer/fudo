import { describe, expect, test } from 'bun:test'
import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { sessionPlugin } from '@jozo-harness/session'
import { jsonlSessions, sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { toolsPlugin } from '@jozo-harness/tools'
import { replayAdapter } from '@jozo-harness/test-support-replay'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
    "    name: '@jozo-harness/kernel'",
    '  - id: sessions',
    "    name: '@jozo-harness/session'",
    '  - id: session-jsonl',
    "    name: '@jozo-harness/session-jsonl'",
    '    config:',
    `      root: ${root}`,
    '  - id: tools',
    "    name: '@jozo-harness/tools'",
    '  - id: system-prompt',
    "    name: '@jozo-harness/system-prompt'",
    '  - id: llm',
    '    name: replay-llm',
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

describe('replay through the CLI', () => {
  test('the recorded tool calls reach the pipeline and land in the log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-replay-'))
    const sse = await readFile(
      new URL(
        '../../../packages/llm/llm-openai/fixtures/ollama-cloud-tool-call.sse',
        import.meta.url,
      ),
      'utf8',
    )
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
