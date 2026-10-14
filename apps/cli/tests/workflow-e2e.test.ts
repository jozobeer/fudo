import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type LlmRequest, type StreamChunk } from '@fudo/llm'
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

const toolTurn = (name: string, args: unknown): ReadonlyArray<StreamChunk> => [
  {
    type: 'block-end',
    index: 0,
    block: { type: 'tool-call', id: 'c-' + name, name, arguments: JSON.stringify(args) },
  },
  { type: 'finish', kind: 'tool-calls' },
]

const lastUserText = (request: LlmRequest): string => {
  const users = request.messages.filter((message) => message.role === 'user')
  const last = users[users.length - 1]
  return (
    last?.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('') ?? ''
  )
}

/** Answers each child by its task, and gives the parent one workflow of two tasks. */
const stubLlm = (children: Readonly<Record<string, string>>): Plugin<{}, Llm, never> => {
  let parentStep = 0
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
        stream: (request) => {
          const last = lastUserText(request)
          const answer = children[last]
          if (answer !== undefined) return Stream.fromIterable(textTurn(answer))
          parentStep += 1
          if (parentStep === 1) {
            return Stream.fromIterable(
              toolTurn('workflow', {
                tasks: [
                  { id: 'a', task: 'answer one' },
                  { id: 'b', task: 'answer two', expect: 'json' },
                ],
              }),
            )
          }
          return Stream.fromIterable(textTurn('done'))
        },
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

describe('a workflow through the command', () => {
  test('fans out children and keeps one unreadable answer from failing the rest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-workflow-'))

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
          stubLlm({ 'answer one': 'first', 'answer two': 'not json at all' }),
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: '/tmp',
        route: 'stub/model',
        task: 'fan out',
        subagents: true,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    // The parent and one child per task.
    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    expect(sessions).toHaveLength(3)

    const opened = await Promise.all(
      sessions.map((summary) => Effect.runPromise(jsonlSessions({ root }).open(summary.id))),
    )
    const result = opened
      .flatMap((session) => session.events)
      .find((event) => event.type === 'tool/result')
    const content = JSON.stringify(result?.type === 'tool/result' ? result.data.content : [])

    expect(content).toContain('a: first')
    expect(content).toContain('b: (failed: the answer is not JSON)')

    await rm(root, { recursive: true, force: true })
  })
})
