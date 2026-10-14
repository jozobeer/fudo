import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { safetyPlugin } from '@fudo/safety'
import { lastRequestHeader, sessionPlugin, type SessionEvent } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { tier0Plugin } from '@fudo/tools-tier0'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

interface SentRequest {
  readonly provider: string
  readonly model: string
  readonly params: unknown
  readonly tools: unknown
}

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

/** Records what each request was assembled with, as the provider received it. */
const spy = (sent: Array<SentRequest>): Plugin<{}, Llm, never> => ({
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
        sent.push({
          provider: request.provider,
          model: request.model,
          params: request.params,
          tools: request.tools,
        })
        return Stream.fromIterable(textTurn('ok'))
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
    '      root: ' + root,
    '  - id: tools',
    "    name: '@fudo/tools'",
    '  - id: system-prompt',
    "    name: '@fudo/system-prompt'",
    '  - id: safety',
    "    name: '@fudo/safety'",
    '    config:',
    '      preset: full',
    '  - id: tier0',
    "    name: '@fudo/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('the request header through the command', () => {
  test('the log recovers the tools a request carried, and a second turn reuses the header', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-header-'))
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-ws-'))
    const sent: Array<SentRequest> = []

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
          tier0Plugin,
          spy(sent),
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: workspace,
        route: 'stub/model',
        lines: Stream.make('first', 'second'),
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))
    const headers = opened.events.flatMap((event: SessionEvent) =>
      event.type === 'request/header' ? [event.data] : [],
    )
    const header = headers[0]
    const firstSent = sent[0]
    if (header === undefined || firstSent === undefined) {
      throw new Error('the request was never recorded')
    }

    // Two turns, one series: nothing about the request changed.
    expect(headers).toHaveLength(1)
    expect(sent).toHaveLength(2)

    // What the log says the request carried is what the provider received.
    expect(header.series).toBe(1)
    expect(header.reason).toBe('opened')
    expect(JSON.stringify(header.tools)).toBe(JSON.stringify(firstSent.tools))
    expect(header.provider).toBe(firstSent.provider)
    expect(JSON.stringify(header.params)).toBe(JSON.stringify(firstSent.params))
    expect(header.tools.map((tool) => tool.name)).toEqual([
      'read',
      'write',
      'edit',
      'glob',
      'grep',
      'bash',
    ])
    // The log alone is enough: the newest header is the one those requests used.
    expect(lastRequestHeader(opened.events)?.tools).toEqual(header.tools)

    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })
})
