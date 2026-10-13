import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const BIG = 'x'.repeat(40_000)

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
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
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

/** Captures the text blocks of every message the model is sent. */
const spy = (seen: Array<ReadonlyArray<string>>): Plugin<{}, Llm, never> => ({
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
        seen.push(
          request.messages.flatMap((message) =>
            message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])),
          ),
        )
        return Stream.fromIterable(textTurn('ok'))
      },
    } satisfies LlmAdapter),
})

describe('compaction through the command', () => {
  test('an old oversized message is shortened before a later request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-compact-'))
    const tasks = [BIG, 'two', 'three', 'four', 'five', 'six', 'seven']

    let resume: string | undefined = undefined
    for (const task of tasks) {
      const seen: Array<ReadonlyArray<string>> = []
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
            spy(seen),
            agentPlugin,
            agentLoopPlugin,
          ] as ReadonlyArray<Plugin<any, any, any>>,
          cwd: '/tmp',
          route: 'stub/model',
          task,
          stdout: () => undefined,
          stderr: () => undefined,
          ...(resume === undefined ? {} : { resume }),
        }),
      )
      expect(code).toBe(0)
      const listed = await Effect.runPromise(jsonlSessions({ root }).list())
      resume = listed[0]?.id ?? undefined

      if (task === 'seven') {
        const texts = seen[0] ?? []
        expect(texts.some((text) => text.startsWith('[earlier output of 40000 bytes]'))).toBe(true)
        expect(texts.some((text) => text === BIG)).toBe(false)
      }
    }

    await rm(root, { recursive: true, force: true })
  })
})
