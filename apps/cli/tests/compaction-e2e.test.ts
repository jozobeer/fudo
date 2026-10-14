import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type LlmUsage, type StreamChunk } from '@fudo/llm'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { deriveMessages, sessionPlugin } from '@fudo/session'
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

/** What the model was sent, in the shape the log can be read back into. */
interface SentMessage {
  readonly role: string
  readonly text: string
}

const asSeen = (
  messages: ReadonlyArray<{
    role: string
    content: ReadonlyArray<{ type: string; text?: string }>
  }>,
): ReadonlyArray<SentMessage> =>
  messages.map((message) => ({
    role: message.role,
    text: message.content
      .flatMap((block) => (block.type === 'text' ? [block.text ?? ''] : []))
      .join('\n'),
  }))

/** Captures every request the model made, with the usage it reported when given. */
const spy = (
  seen: Array<ReadonlyArray<SentMessage>>,
  usage?: LlmUsage,
): Plugin<{}, Llm, never> => ({
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
        seen.push(asSeen(request.messages))
        return Stream.fromIterable([
          ...(usage === undefined ? [] : [{ type: 'usage' as const, usage }]),
          ...textTurn('ok'),
        ])
      },
    } satisfies LlmAdapter),
})

const profile = (root: string, loopConfig?: string): string =>
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
    ...(loopConfig === undefined
      ? []
      : ['    config:', ...loopConfig.split('\n').map((l) => '      ' + l)]),
  ].join('\n')

const plugins = (llm: Plugin<{}, Llm, never>): ReadonlyArray<Plugin<any, any, any>> => [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  safetyPlugin,
  askPlugin,
  llm,
  agentPlugin,
  agentLoopPlugin,
]

const open = async (root: string) => {
  const listed = await Effect.runPromise(jsonlSessions({ root }).list())
  return {
    id: listed[0]?.id ?? '',
    opened: await Effect.runPromise(jsonlSessions({ root }).open(listed[0]?.id ?? '')),
  }
}

/** Runs one task per turn in the same session and reports the last request and log. */
const runTasks = async (
  root: string,
  tasks: ReadonlyArray<string>,
  loopConfig?: string,
  usage?: LlmUsage,
): Promise<{
  readonly sent: ReadonlyArray<SentMessage>
  readonly opened: Awaited<ReturnType<typeof open>>['opened']
}> => {
  let resume: string | undefined = undefined
  let sent: ReadonlyArray<SentMessage> = []
  for (const task of tasks) {
    const seen: Array<ReadonlyArray<SentMessage>> = []
    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root, loopConfig)],
        plugins: plugins(spy(seen, usage)),
        cwd: '/tmp',
        route: 'stub/model',
        task,
        stdout: () => undefined,
        stderr: () => undefined,
        ...(resume === undefined ? {} : { resume }),
      }),
    )
    expect(code).toBe(0)
    sent = seen[0] ?? []
    resume = (await open(root)).id
  }
  return { sent, opened: (await open(root)).opened }
}

describe('compaction through the command', () => {
  test('the log alone reconstructs the request the model was sent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-compact-'))
    const { sent, opened } = await runTasks(
      root,
      [BIG, 'two', 'three', 'four', 'five', 'six', 'seven'],
      // A window small enough that this conversation is over the threshold.
      'contextWindow: 8000\nheadroomTokens: 0',
    )

    const texts = sent.map((message) => message.text)
    expect(texts.some((text) => text.startsWith('[earlier output of 40000 bytes]'))).toBe(true)
    expect(texts.some((text) => text === BIG)).toBe(false)

    // The request is derived from the log: the logged events, folded with the
    // recorded prune, are exactly what the model was sent (plus its answer).
    const derived = asSeen(deriveMessages(opened.events))
    expect(opened.events.some((event) => event.type === 'compaction/prune')).toBe(true)
    expect(sent.length).toBeGreaterThan(0)
    expect(derived.slice(0, sent.length)).toEqual([...sent])

    await rm(root, { recursive: true, force: true })
  })

  test('the profile row decides when a message is pruned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-compact-'))
    const small = 'y'.repeat(100)

    const { sent, opened } = await runTasks(
      root,
      [small, 'second'],
      'keepLast: 1\nmaxBytes: 10\ncontextWindow: 100\nheadroomTokens: 0',
    )

    const prune = opened.events.find((event) => event.type === 'compaction/prune')
    expect(prune?.type === 'compaction/prune' ? prune.data.shadowedBytes : 0).toBeGreaterThan(0)
    expect(sent.some((message) => message.text === small)).toBe(false)

    await rm(root, { recursive: true, force: true })
  })

  test('a conversation with room left is sent untouched', async () => {
    const roomy = await mkdtemp(join(tmpdir(), 'fudo-compact-'))
    const tight = await mkdtemp(join(tmpdir(), 'fudo-compact-'))
    const first = 'the first thing the model was told'
    const tasks = [first, 'second']

    const under = await runTasks(
      roomy,
      tasks,
      'keepLast: 1\nmaxBytes: 10\ncontextWindow: 100000\nheadroomTokens: 0',
    )
    const over = await runTasks(
      tight,
      tasks,
      'keepLast: 1\nmaxBytes: 10\ncontextWindow: 100\nheadroomTokens: 0',
    )

    // The same history, the same prune price: only the budget decides.
    expect(under.opened.events.some((event) => event.type === 'compaction/prune')).toBe(false)
    expect(under.sent.some((message) => message.text === first)).toBe(true)
    expect(over.opened.events.some((event) => event.type === 'compaction/prune')).toBe(true)
    expect(over.sent.some((message) => message.text === first)).toBe(false)

    await rm(roomy, { recursive: true, force: true })
    await rm(tight, { recursive: true, force: true })
  })

  test('what the provider counted is what pushes the request over', async () => {
    const roomy = await mkdtemp(join(tmpdir(), 'fudo-compact-'))
    const tight = await mkdtemp(join(tmpdir(), 'fudo-compact-'))
    const first = 'the first thing the model was told'
    const tasks = [first, 'second']
    const budget =
      'keepLast: 1\nmaxBytes: 10\ncontextWindow: 1000\nthresholdRatio: 0.9\nheadroomTokens: 0'

    // The bytes are tiny in both runs; only the reported usage differs.
    const under = await runTasks(roomy, tasks, budget, { inputTokens: 5, outputTokens: 5 })
    const over = await runTasks(tight, tasks, budget, { inputTokens: 900, outputTokens: 50 })

    expect(under.opened.events.some((event) => event.type === 'compaction/prune')).toBe(false)
    expect(over.opened.events.some((event) => event.type === 'compaction/prune')).toBe(true)

    await rm(roomy, { recursive: true, force: true })
    await rm(tight, { recursive: true, force: true })
  })
})
