import { describe, expect, test } from 'bun:test'
import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCommand } from '../src/index.ts'

const reply: ReadonlyArray<StreamChunk> = [
  { type: 'text-delta', index: 0, text: 'ok' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } },
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
    '      root: ' + root,
    '  - id: tools',
    "    name: '@fudo/tools'",
    '  - id: system-prompt',
    "    name: '@fudo/system-prompt'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('repl', () => {
  test('each input line becomes a turn on the same session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-repl-'))
    const stub: Plugin<{}, Llm, never> = {
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
          stream: () => Stream.fromIterable(reply),
        } satisfies LlmAdapter),
    }

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins: [
          kernelPlugin,
          sessionJsonlPlugin,
          sessionPlugin,
          toolsPlugin,
          systemPromptPlugin,
          stub,
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: '/work',
        route: 'stub/model',
        lines: Stream.make('first', '', 'second'),
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    expect(code).toBe(0)
    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    expect(sessions).toHaveLength(1)
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))
    const users = opened.events.flatMap((event) =>
      event.type === 'user/message' && event.data.source === 'user' ? [event.data.text] : [],
    )
    const turns = opened.events.filter((event) => event.type === 'turn/start')
    const ends = opened.events.filter((event) => event.type === 'turn/end')

    expect(users).toEqual(['first', 'second'])
    expect(turns).toHaveLength(2)
    expect(ends).toHaveLength(2)
    await rm(root, { recursive: true, force: true })
  })
})
