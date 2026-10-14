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

const reply = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const makeStub = (seen: Array<ReadonlyArray<string>>): Plugin<{}, Llm, never> => ({
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
        return Stream.fromIterable(reply('ok'))
      },
    } satisfies LlmAdapter),
})

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
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('resume', () => {
  test('a resumed session keeps the earlier history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-resume-'))
    const seen: Array<ReadonlyArray<string>> = []
    const plugins: ReadonlyArray<Plugin<any, any, any>> = [
      kernelPlugin,
      sessionJsonlPlugin,
      sessionPlugin,
      toolsPlugin,
      systemPromptPlugin,
      makeStub(seen),
      agentPlugin,
      agentLoopPlugin,
    ]
    const io = { stdout: () => undefined, stderr: () => undefined, cwd: '/work' }
    const run = (task: string, resume?: string) =>
      Effect.runPromise(
        runCommand({
          profiles: [profile(root)],
          plugins,
          cwd: '/work',
          route: 'stub/model',
          task,
          stdout: io.stdout,
          stderr: io.stderr,
          ...(resume === undefined ? {} : { resume }),
        }),
      )

    expect(await run('first task')).toBe(0)
    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    expect(sessions).toHaveLength(1)
    const id = sessions[0]?.id ?? ''

    expect(await run('second task', id)).toBe(0)

    const reopened = await Effect.runPromise(jsonlSessions({ root }).open(id))
    const turns = reopened.events.filter((event) => event.type === 'turn/start')
    const users = reopened.events.flatMap((event) =>
      event.type === 'user/message' && event.data.source === 'user' ? [event.data.text] : [],
    )

    expect(turns).toHaveLength(2)
    expect(users).toEqual(['first task', 'second task'])
    expect(seen[1]?.join(' ')).toContain('first task')
    await rm(root, { recursive: true, force: true })
  })
})
