import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { askPlugin, safetyPlugin } from '@jozo-harness/safety'
import { deriveMessages, sessionPlugin } from '@jozo-harness/session'
import { jsonlSessions, sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { toolsPlugin } from '@jozo-harness/tools'
import { tier0Plugin } from '@jozo-harness/tools-tier0'
import { tier1Plugin } from '@jozo-harness/tools-tier1'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const callTool = (name: string, args: unknown): ReadonlyArray<StreamChunk> => [
  {
    type: 'block-end',
    index: 0,
    block: { type: 'tool-call', id: 'c-' + name, name, arguments: JSON.stringify(args) },
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
    '  - id: ask',
    "    name: '@jozo-harness/ask'",
    '  - id: tier0',
    "    name: '@jozo-harness/tools-tier0'",
    '  - id: tier1',
    "    name: '@jozo-harness/tools-tier1'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

const isSnapshot = (event: { type: string; data: unknown }): boolean =>
  event.type === 'user/message' && (event.data as { source?: string }).source === 'runtime-context'

describe('the runtime context through the command', () => {
  test('the model reads the workspace and the permissions, and a change adds one snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-runtime-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-ws-'))
    const sub = join(workspace, 'sub')
    await mkdir(sub, { recursive: true })

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
          stubLlm([
            callTool('working_directory', { path: 'sub' }),
            textTurn('moved'),
            textTurn('done'),
          ]),
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: workspace,
        route: 'stub/model',
        lines: Stream.make('look in sub', 'and again'),
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))
    const snapshots = opened.events.filter(isSnapshot)

    // One snapshot names the starting workspace; the move adds exactly one more.
    expect(snapshots).toHaveLength(2)
    const first = JSON.stringify(snapshots[0]?.data)
    const second = JSON.stringify(snapshots[1]?.data)

    expect(first).toContain('Current runtime context:')
    expect(first).toContain('cwd: ' + workspace)
    expect(first).toContain('approval: workspace-write')
    // The fact the model reads is the mode its commands run under, not the provider.
    expect(first).toContain('sandbox: workspace-write')
    expect(first).toMatch(/time: \d{4}-\d{2}-\d{2}T/)
    expect(second).toContain('cwd: ' + sub)

    // The prompt opens the request, the snapshot follows it, and the human input comes last.
    const firstIndex = (matches: (event: (typeof opened.events)[number]) => boolean): number =>
      opened.events.findIndex(matches)
    const system = firstIndex((event) => event.type === 'system/message')
    const snapshot = firstIndex((event) => isSnapshot(event))
    const task = firstIndex(
      (event) =>
        event.type === 'user/message' && (event.data as { source?: string }).source === 'user',
    )
    expect(system).toBeLessThan(snapshot)
    expect(snapshot).toBeLessThan(task)

    // What the model reads is the same order: system, snapshot, then the task.
    const messages = deriveMessages(opened.events)
    expect(messages[0]?.role).toBe('system')
    const context = messages[1]
    expect(context?.role).toBe('user')
    expect(context?.content[0]?.type === 'text' ? context.content[0].text : '').toContain(
      'cwd: ' + workspace,
    )

    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })
})
