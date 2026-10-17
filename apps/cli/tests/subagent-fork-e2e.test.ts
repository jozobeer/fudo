import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { askPlugin, safetyPlugin } from '@jozo-harness/safety'
import { sessionPlugin } from '@jozo-harness/session'
import { jsonlSessions, sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { tier1Plugin } from '@jozo-harness/tools-tier1'
import { toolsPlugin } from '@jozo-harness/tools'
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

const subagentTurn: ReadonlyArray<StreamChunk> = [
  {
    type: 'block-end',
    index: 0,
    block: {
      type: 'tool-call',
      id: 'c1',
      name: 'subagent',
      arguments: JSON.stringify({ task: 'child task' }),
    },
  },
  { type: 'finish', kind: 'tool-calls' },
]

const stub = (scripts: ReadonlyArray<ReadonlyArray<StreamChunk>>): Plugin<{}, Llm, never> => {
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
          const script = scripts[step] ?? []
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
    '      preset: full',
    '  - id: ask',
    "    name: '@jozo-harness/ask'",
    '  - id: tier1',
    "    name: '@jozo-harness/tools-tier1'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

const plugins = (llm: Plugin<{}, Llm, never>): ReadonlyArray<Plugin<any, any, any>> => [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  safetyPlugin,
  askPlugin,
  tier1Plugin,
  llm,
  agentPlugin,
  agentLoopPlugin,
]

describe('a forked child', () => {
  test('starts from what the parent already did', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-fork-'))
    const io = { stdout: () => undefined, stderr: () => undefined, cwd: '/tmp' }

    const first = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins: plugins(stub([textTurn('first answer')])),
        route: 'stub/model',
        task: 'first task',
        subagents: true,
        ...io,
      }),
    )
    expect(first).toBe(0)

    const listed = await Effect.runPromise(jsonlSessions({ root }).list())
    const parentId = listed[0]?.id ?? ''

    const second = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins: plugins(stub([subagentTurn, textTurn('child answer'), textTurn('parent answer')])),
        route: 'stub/model',
        task: 'second task',
        resume: parentId,
        subagents: true,
        ...io,
      }),
    )
    expect(second).toBe(0)

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const childId = sessions.map((summary) => summary.id).find((id) => id !== parentId) ?? ''
    const child = await Effect.runPromise(jsonlSessions({ root }).open(childId))
    const childTexts = child.events.flatMap((event) =>
      event.type === 'user/message' ? [event.data.text] : [],
    )

    expect(sessions).toHaveLength(2)
    expect(childTexts).toContain('first task')
    expect(childTexts).not.toContain('second task')
    await rm(root, { recursive: true, force: true })
  })
})
