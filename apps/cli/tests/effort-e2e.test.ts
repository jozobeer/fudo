import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin, type PluginRow } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { safetyPlugin } from '@jozo-harness/safety'
import { sessionPlugin } from '@jozo-harness/session'
import { sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { toolsPlugin } from '@jozo-harness/tools'
import { tier0Plugin } from '@jozo-harness/tools-tier0'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { runCommand } from '../src/index.ts'

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

/** Records the params of every request, as the provider received them. */
const spy = (sent: Array<Readonly<Record<string, unknown>>>): Plugin<{}, Llm, never> => ({
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
      stream: (request) => {
        sent.push(request.params as Readonly<Record<string, unknown>>)
        return Stream.fromIterable(textTurn('ok'))
      },
    } satisfies LlmAdapter),
})

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
    '      root: ' + root,
    '  - id: tools',
    "    name: '@jozo-harness/tools'",
    '  - id: system-prompt',
    "    name: '@jozo-harness/system-prompt'",
    '  - id: safety',
    "    name: '@jozo-harness/safety'",
    '    config:',
    '      preset: workspace-write',
    '      sandbox: none',
    '  - id: tier0',
    "    name: '@jozo-harness/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

const run = async (input: {
  readonly effort?: string
  readonly extraRows?: ReadonlyArray<PluginRow>
}): Promise<ReadonlyArray<Readonly<Record<string, unknown>>>> => {
  const root = await mkdtemp(join(tmpdir(), 'jozo-harness-effort-'))
  const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-effort-ws-'))
  const sent: Array<Readonly<Record<string, unknown>>> = []
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
        spy(sent),
        agentPlugin,
        agentLoopPlugin,
      ] as ReadonlyArray<Plugin<any, any, any>>,
      ...(input.extraRows === undefined ? {} : { extraRows: input.extraRows }),
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      cwd: workspace,
      route: 'stub/model',
      task: 'go',
      stdout: () => undefined,
      stderr: () => undefined,
    }),
  )
  await rm(root, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
  expect(code).toBe(0)
  return sent
}

/** A row that names the effort the way the docs say any row may. */
const rowNaming = (effort: string): PluginRow => ({
  id: 'agent-loop',
  name: '@jozo-harness/agent-loop',
  config: { effort },
})

describe('effort through the command', () => {
  test('the effort reaches the provider as the field it reads', async () => {
    const sent = await run({ effort: 'high' })

    expect(sent[0]).toEqual({ reasoning_effort: 'high' })
  })

  test('no effort anywhere leaves the provider to choose', async () => {
    const sent = await run({})

    expect(sent[0]).toEqual({})
  })

  test('a row may name the effort, and the flag still wins', async () => {
    const fromRow = await run({ extraRows: [rowNaming('low')] })
    const flagged = await run({ extraRows: [rowNaming('low')], effort: 'high' })

    expect(fromRow[0]).toEqual({ reasoning_effort: 'low' })
    expect(flagged[0]).toEqual({ reasoning_effort: 'high' })
  })
})
