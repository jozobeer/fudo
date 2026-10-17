import { describe, expect, test } from 'vitest'
import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { sessionPlugin } from '@jozo-harness/session'
import { sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { toolsPlugin } from '@jozo-harness/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { runCommand } from '../src/index.ts'

const reply = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
  { type: 'finish', kind: 'stop' },
]

const stubLlm: Plugin<{}, Llm, never> = {
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
      stream: () => Stream.fromIterable(reply('pong')),
    } satisfies LlmAdapter),
}

const plugins = [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  stubLlm,
  agentPlugin,
  agentLoopPlugin,
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
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

describe('runCommand', () => {
  test('headless task streams the assistant text and exits 0', async () => {
    const out: Array<string> = []
    const err: Array<string> = []

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile('/tmp/jozo-harness-cli-test')],
        plugins,
        task: 'ping',
        cwd: '/work',
        route: 'stub/model',
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
      }),
    )

    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(out.join('')).toContain('pong')
  })

  test('dump-config prints the effective rows without building the layer', async () => {
    const out: Array<string> = []
    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile('/tmp/jozo-harness-cli-test')],
        plugins,
        cwd: '/work',
        route: 'stub/model',
        dumpConfig: true,
        stdout: (text) => out.push(text),
        stderr: () => undefined,
      }),
    )

    expect(code).toBe(0)
    expect(out.join('')).toContain('id=agent-loop')
  })
})
