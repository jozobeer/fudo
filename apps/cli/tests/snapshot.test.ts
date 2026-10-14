import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { loadBundledProfile } from '@fudo/bundle-base'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { sessionPlugin, type SessionEvent } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { tier0Plugin } from '@fudo/tools-tier0'
import { tier1Plugin } from '@fudo/tools-tier1'
import {
  replayAdapter,
  runScenario,
  firstDifference,
  type Scenario,
} from '@fudo/test-support-replay'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

/** Where the recorded outcomes live, one file per scenario. */
const SNAPSHOTS = new URL('./snapshots/', import.meta.url)

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

/** The recorded stream of a real tool-calling turn, replayed as it was decoded. */
const recorded = async (): Promise<string> =>
  Bun.file(
    new URL(
      '../../../packages/llm/llm-openai/fixtures/ollama-cloud-tool-call.sse',
      import.meta.url,
    ),
  ).text()

/** A stream of chunks, written as the SSE a provider would have sent. */
const sseOf = (turn: ReadonlyArray<StreamChunk>): string =>
  turn
    .map(
      (chunk, index) =>
        'data: ' +
        JSON.stringify({
          id: 'chatcmpl-scenario',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'replay',
          choices: [
            {
              index: 0,
              delta: index === 0 ? { role: 'assistant', ...deltaOf(chunk) } : deltaOf(chunk),
              finish_reason: chunk.type === 'finish' ? finishWordOf(chunk.kind) : null,
            },
          ],
        }) +
        (index === 0 ? '' : ''),
    )
    .join('\n') + '\ndata: [DONE]\n'

/** The words a provider uses to say why it stopped. */
const finishWordOf = (kind: string): string => (kind === 'tool-calls' ? 'tool_calls' : kind)

const deltaOf = (chunk: StreamChunk): Record<string, unknown> => {
  if (chunk.type === 'text-delta') return { content: chunk.text }
  if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
    return {
      tool_calls: [
        {
          index: 0,
          id: chunk.block.id,
          type: 'function',
          function: { name: chunk.block.name, arguments: chunk.block.arguments },
        },
      ],
    }
  }
  return {}
}

/** Runs one scenario through the shipping composition and answers with its log. */
const runner = async (run: {
  readonly workspace: string
  readonly logs: string
  readonly streams: ReadonlyArray<string>
  readonly approve: boolean | undefined
  readonly task: string | undefined
  readonly lines: ReadonlyArray<string> | undefined
}): Promise<{ readonly code: number; readonly events: ReadonlyArray<SessionEvent> }> => {
  let step = 0
  const llm: Plugin<{}, Llm, never> = {
    name: 'replay-llm',
    config: Schema.Struct({}),
    provides: [Llm],
    requires: [],
    layer: () => {
      const adapters = run.streams.map((sse) => replayAdapter(sse))
      return Layer.succeed(Llm, {
        name: 'replay',
        capabilities: {
          toolChoice: false,
          reasoningEffort: null,
          images: 'none',
          promptCacheControl: false,
        },
        stream: () => {
          const adapter = adapters[step] ?? replayAdapter(sseOf(textTurn('done')))
          step += 1
          return adapter.stream({
            provider: 'replay',
            model: 'model',
            messages: [],
            tools: undefined,
            params: {},
          }) as Stream.Stream<StreamChunk, never>
        },
      } satisfies LlmAdapter)
    },
  }
  const code = await Effect.runPromise(
    runCommand({
      profiles: [await loadBundledProfile()],
      extraRows: [
        { id: 'session-jsonl', name: '@fudo/session-jsonl', config: { root: run.logs } },
        // The recording stands in for the provider the profile names.
        { id: 'llm', name: 'replay-llm', config: {} },
      ],
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
        llm,
        agentPlugin,
        agentLoopPlugin,
      ] as ReadonlyArray<Plugin<any, any, any>>,
      cwd: run.workspace,
      route: 'replay/model',
      ...(run.task === undefined
        ? { lines: Stream.fromIterable(run.lines ?? []) }
        : { task: run.task }),
      approve: () => Effect.succeed(run.approve === true),
      stdout: () => undefined,
      stderr: () => undefined,
    }),
  )
  const listed = await Effect.runPromise(jsonlSessions({ root: run.logs }).list())
  const id = listed[0]?.id
  // A run that wrote no log still has a code to record, and that code is the finding.
  if (id === undefined) return { code, events: [] }
  const opened = await Effect.runPromise(jsonlSessions({ root: run.logs }).open(id))
  return { code, events: opened.events }
}

const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    name: 'tool-call',
    task: 'write the notes and read them back',
    files: { 'notes.txt': 'one\ntwo\n' },
    streams: [
      sseOf(toolTurn('read', { path: 'notes.txt' }, 'c1')),
      sseOf(toolTurn('write', { path: 'notes.txt', content: 'one\ntwo\nthree\n' }, 'c2')),
      sseOf(textTurn('the notes now hold three lines')),
    ],
  },
  {
    name: 'recorded-stream',
    task: 'run the recorded turn',
    streams: [await recorded()],
  },
]

/** The snapshot on disk, or nothing when this scenario has never been recorded. */
const snapshotOf = async (name: string): Promise<string | undefined> =>
  readFile(new URL(name + '.txt', SNAPSHOTS), 'utf8').catch(() => undefined)

describe('replaying a recording', () => {
  for (const scenario of SCENARIOS) {
    test('the log a scenario leaves is the one on record: ' + scenario.name, async () => {
      const outcome = await runScenario(scenario, runner)
      const recorded = await snapshotOf(scenario.name)

      if (process.env.UPDATE_SNAPSHOTS === '1') {
        await mkdir(dirname(new URL(scenario.name + '.txt', SNAPSHOTS).pathname), {
          recursive: true,
        })
        await writeFile(new URL(scenario.name + '.txt', SNAPSHOTS), outcome.snapshot)
        return
      }

      expect(recorded).toBeDefined()
      const difference = firstDifference(recorded ?? '', outcome.snapshot)
      expect(
        difference === undefined
          ? undefined
          : difference + '\n(update with UPDATE_SNAPSHOTS=1 bun test snapshot)',
      ).toBeUndefined()
    })
  }
})
