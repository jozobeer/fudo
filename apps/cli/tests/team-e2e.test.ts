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

const textOf = (request: LlmRequest): string =>
  request.messages
    .flatMap((message) => message.content)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')

/** The teammate's turn is the one whose user message is the work handed to it. */
const isChildTurn = (request: LlmRequest): boolean =>
  request.messages.some(
    (message) =>
      message.role === 'user' &&
      message.content.some((block) => block.type === 'text' && block.text === 'write the guide'),
  )

const childIdIn = (request: LlmRequest): string =>
  /\[child session: ([^\]]+)\]/.exec(textOf(request))?.[1] ?? 'missing'

/** The lead spawns a teammate, hands it work, waits, then records the board. */
const leadTurn = (step: number, request: LlmRequest): ReadonlyArray<StreamChunk> => {
  if (step === 1) {
    return toolTurn('team', { action: 'spawn', name: 'builder', role: 'writes the guide' })
  }
  if (step === 2) return toolTurn('team', { action: 'create', title: 'write the guide' })
  if (step === 3)
    return toolTurn('send_message', { id: childIdIn(request), message: 'write the guide' })
  if (step === 4) return toolTurn('wait_agent', { id: childIdIn(request) })
  if (step === 5) {
    return toolTurn('team', { action: 'update', id: 'task-1', state: 'done', revision: 1 })
  }
  return textTurn('the guide is written')
}

const stubLlm = (): Plugin<{}, Llm, never> => {
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
          if (isChildTurn(request)) return Stream.fromIterable(textTurn('the guide is written'))
          const script = leadTurn(step, request)
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

describe('a team through the command', () => {
  test('the lead spawns a teammate, hands out work, and moves the board', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-team-'))
    const errs: Array<string> = []
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
        cwd: '/tmp',
        route: 'stub/model',
        task: 'get the guide written',
        subagents: true,
        stdout: () => undefined,
        stderr: (text) => {
          errs.push(text)
        },
      }),
    )

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    expect(errs.join('')).toBe('')
    expect(code).toBe(0)
    // The lead and its one teammate, each with its own log.
    expect(sessions).toHaveLength(2)
    const logs = await Promise.all(
      sessions.map((session) =>
        Effect.runPromise(jsonlSessions({ root }).open(session.id)).then((opened) => opened.events),
      ),
    )
    const lead = logs.find((events) => events.some((event) => event.type === 'team/spawned'))
    const child = logs.find((events) => events !== lead)
    const spoken = (
      events: ReadonlyArray<{ readonly type: string; readonly data: unknown }>,
    ): ReadonlyArray<string> =>
      events.flatMap((event) =>
        event.type === 'user/message' && (event.data as { source: string }).source === 'user'
          ? [(event.data as { text: string }).text]
          : [],
      )

    expect(
      lead?.flatMap((event) => (event.type === 'team/spawned' ? [event.data] : [])),
    ).toHaveLength(1)
    expect(
      lead?.flatMap((event) => (event.type === 'team/task/updated' ? [event.data] : [])),
    ).toEqual([{ task: { id: 'task-1', title: 'write the guide', state: 'done', revision: 2 } }])
    // The task reached the teammate as its own turn.
    expect(spoken(child ?? [])).toEqual(['write the guide'])

    await rm(root, { recursive: true, force: true })
  })
})
