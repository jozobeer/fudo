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
import { tier1Plugin } from '@fudo/tools-tier1'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const toolTurn = (name: string, args: unknown, id: string): ReadonlyArray<StreamChunk> => [
  {
    type: 'block-end',
    index: 0,
    block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) },
  },
  { type: 'finish', kind: 'tool-calls' },
]

/** Read a file, edit it, then run a command that fails. */
const SCRIPT: ReadonlyArray<ReadonlyArray<StreamChunk>> = [
  toolTurn('read', { path: 'notes.txt' }, 'c1'),
  toolTurn('edit', { path: 'notes.txt', oldString: 'a', newString: 'b' }, 'c2'),
  toolTurn('bash', { command: 'echo x; exit 3' }, 'c3'),
  textTurn('done'),
]

const stubLlm = (): Plugin<{}, Llm, never> => {
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
        stream: () => Stream.fromIterable(SCRIPT[step++] ?? textTurn('done')),
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
    '      # The presentation is what this test watches, not the sandbox.',
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

describe('the line a tool shows through the command', () => {
  test('the pipeline renders it, and the log carries it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-present-'))
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-present-ws-'))
    await Bun.write(join(workspace, 'notes.txt'), 'a\n')

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
          stubLlm(),
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: workspace,
        route: 'stub/model',
        task: 'change the notes',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    const listed = await Effect.runPromise(jsonlSessions({ root }).list())
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(listed[0]?.id ?? ''))
    const calls = opened.events.flatMap((event) =>
      event.type === 'tool/call' ? [event.data.summary ?? ''] : [],
    )
    const results = opened.events.flatMap((event) =>
      event.type === 'tool/result' ? [{ tool: '', summary: event.data.summary ?? '' }] : [],
    )

    expect(code).toBe(0)
    // Each call says what it is about to do, without the raw arguments.
    expect(calls).toEqual(['read notes.txt', 'edit notes.txt lines: 1 → 1', 'bash echo x; exit 3'])
    // The failure says the exit code, not the first line of output.
    expect(results.at(-1)?.summary).toBe('exit 3')
    // The file really changed, so the summaries describe what happened.
    expect(await Bun.file(join(workspace, 'notes.txt')).text()).toBe('b\n')

    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })
})
