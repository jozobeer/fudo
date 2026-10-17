import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type LlmRequest, type StreamChunk } from '@jozo-harness/llm'
import { askPlugin, safetyPlugin } from '@jozo-harness/safety'
import { sessionPlugin } from '@jozo-harness/session'
import { jsonlSessions, sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { toolsPlugin } from '@jozo-harness/tools'
import { tier0Plugin } from '@jozo-harness/tools-tier0'
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

const childIdsIn = (request: LlmRequest): ReadonlyArray<string> =>
  [...textOf(request).matchAll(/\[child session: ([^\]]+)\]/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  )

/** The child that was handed 'write a haiku' has the last user message of all. */
const isHaiKuTurn = (request: LlmRequest): boolean => textOf(request).includes('write a haiku')

/** The child told to look around runs on the route this call named. */
const isRouteTurn = (request: LlmRequest): boolean => request.model === 'cheap'

/** The parent: one child on another route, one left idle, then work for the idle one. */
const parentTurn = (step: number, request: LlmRequest): ReadonlyArray<StreamChunk> => {
  if (step === 1) return toolTurn('subagent', { task: 'look around', model: 'other/cheap' })
  if (step === 2) return toolTurn('subagent', { context: 'fresh' })
  if (step === 3) {
    const second = childIdsIn(request)[1] ?? 'missing'
    return toolTurn('send_message', { id: second, message: 'write a haiku' })
  }
  if (step === 4) {
    const second = childIdsIn(request)[1] ?? 'missing'
    return toolTurn('wait_agent', { id: second })
  }
  return textTurn('both are done')
}

const stubLlm = (seen: Array<{ provider: string; model: string }>): Plugin<{}, Llm, never> => {
  let step = 1
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
          seen.push({ provider: request.provider, model: request.model })
          if (isRouteTurn(request)) return Stream.fromIterable(textTurn('looked around'))
          if (isHaiKuTurn(request)) return Stream.fromIterable(textTurn('a haiku'))
          const script = parentTurn(step, request)
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

describe('the subagent seam through the command', () => {
  test('a child runs on the route it was given, and an idle child starts from nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-seam-'))
    const errs: Array<string> = []
    const seen: Array<{ provider: string; model: string }> = []
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
          stubLlm(seen),
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: '/tmp',
        route: 'stub/model',
        task: 'delegate twice',
        subagents: true,
        stdout: () => undefined,
        stderr: (text) => {
          errs.push(text)
        },
      }),
    )

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const logOf = (id: string) =>
      Effect.runPromise(jsonlSessions({ root }).open(id)).then((opened) => opened.events)
    const logs = await Promise.all(sessions.map((session) => logOf(session.id)))
    const headers = logs.map((events) =>
      events.flatMap((event) => (event.type === 'request/header' ? [event.data] : [])),
    )
    const usersOf = (events: ReadonlyArray<{ readonly type: string; readonly data: unknown }>) =>
      events.flatMap((event) =>
        event.type === 'user/message' && (event.data as { source: string }).source === 'user'
          ? [(event.data as { text: string }).text]
          : [],
      )

    expect(errs.join('')).toBe('')
    expect(code).toBe(0)
    // The lead and the two children it started.
    expect(sessions).toHaveLength(3)
    // The route this call named reached the wire: the adapter saw the child's request.
    expect(seen).toContainEqual({ provider: 'other', model: 'cheap' })
    expect(
      headers.some((rows) => rows.some((row) => row.provider === 'other' && row.model === 'cheap')),
    ).toBe(true)
    // The idle child was continued by message, and started from nothing: no parent history.
    const haiku = logs.find((events) => usersOf(events).includes('write a haiku'))
    expect(haiku === undefined ? [] : usersOf(haiku)).toEqual(['write a haiku'])

    await rm(root, { recursive: true, force: true })
  })
})
