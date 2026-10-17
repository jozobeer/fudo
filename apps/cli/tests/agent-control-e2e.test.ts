import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type LlmRequest, type StreamChunk } from '@jozo-harness/llm'
import { askPlugin, safetyPlugin } from '@jozo-harness/safety'
import { sessionPlugin } from '@jozo-harness/session'
import { jsonlSessions, sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { toolsPlugin } from '@jozo-harness/tools'
import { tier1Plugin } from '@jozo-harness/tools-tier1'
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

const toolTurn = (name: string, args: unknown): ReadonlyArray<StreamChunk> => [
  {
    type: 'block-end',
    index: 0,
    block: { type: 'tool-call', id: 'c-' + name, name, arguments: JSON.stringify(args) },
  },
  { type: 'finish', kind: 'tool-calls' },
]

const textOf = (request: LlmRequest): string =>
  request.messages
    .flatMap((message) => message.content)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')

/**
 * A child turn is the one whose last user message is the task or the message the
 * parent sent; the parent's own turns carry the original task and tool results.
 */
const CHILD_MESSAGES = ['look around', 'again']

const isChildTurn = (request: LlmRequest): boolean =>
  request.messages.some(
    (message) =>
      message.role === 'user' &&
      message.content.some((block) => block.type === 'text' && CHILD_MESSAGES.includes(block.text)),
  )

const childIdIn = (request: LlmRequest): string =>
  /\[child session: ([^\]]+)\]/.exec(textOf(request))?.[1] ?? 'missing'

const idleIdIn = (request: LlmRequest): string =>
  /^([^\s]+) idle$/m.exec(textOf(request))?.[1] ?? 'missing'

/** The parent's plan: delegate, look, message the child, wait for it, then answer. */
const parentTurn = (step: number, request: LlmRequest): ReadonlyArray<StreamChunk> => {
  if (step === 1) return toolTurn('subagent', { task: 'look around' })
  if (step === 2) return toolTurn('list_agents', {})
  if (step === 3) return toolTurn('send_message', { id: childIdIn(request), message: 'again' })
  if (step === 4) return toolTurn('wait_agent', { id: idleIdIn(request) })
  return textTurn('done')
}

/**
 * Plays both sides: the parent delegates, looks, messages, and waits; the child
 * answers twice, which only happens if the message reached a real agent.
 */
const stubLlm = (): Plugin<{}, Llm, never> => {
  let parentStep = 0
  let childAnswer = 0
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
          if (isChildTurn(request)) {
            childAnswer += 1
            return Stream.fromIterable(
              textTurn(childAnswer === 1 ? 'child says hi' : 'child says again'),
            )
          }
          parentStep += 1
          return Stream.fromIterable(parentTurn(parentStep, request))
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

describe('steering a child agent through the command', () => {
  test('the parent lists, messages, and waits for a child it started', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-control-'))

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
          tier1Plugin,
          stubLlm(),
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: '/tmp',
        route: 'stub/model',
        task: 'steer the child',
        subagents: true,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    expect(sessions).toHaveLength(2)
    const opened = await Promise.all(
      sessions.map((summary) => Effect.runPromise(jsonlSessions({ root }).open(summary.id))),
    )
    const parent = opened.find((session) =>
      session.events.some((event) => event.type === 'tool/result'),
    )
    const child = opened.find((session) => session !== parent)
    const results = (parent?.events ?? []).flatMap((event) =>
      event.type === 'tool/result' ? [JSON.stringify(event.data.content)] : [],
    )

    // The parent saw the child it started, its state, and the wait that ended.
    expect(results[0]).toContain('child says hi')
    expect(results[1]).toContain('idle')
    expect(results[2]).toContain('sent to')
    expect(results[3]).toContain('is idle')

    // The message reached a real agent, which ran a second turn of its own.
    const childTexts = (child?.events ?? []).flatMap((event) =>
      event.type === 'assistant/message'
        ? event.data.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))
        : [],
    )
    expect(childTexts).toEqual(['child says hi', 'child says again'])

    await rm(root, { recursive: true, force: true })
  })
})
