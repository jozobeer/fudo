import { describe, expect, test } from 'vitest'
import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { sessionPlugin } from '@jozo-harness/session'
import { sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { toolsPlugin } from '@jozo-harness/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCommand, type CommandOptions } from '../src/index.ts'

const reply: ReadonlyArray<StreamChunk> = [
  { type: 'text-delta', index: 0, text: 'ok' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } },
  { type: 'finish', kind: 'stop' },
]

/** A profile whose llm row carries `model` when one is given. */
const profile = (root: string, model?: string): string =>
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
    '  - id: llm',
    '    name: stub-llm',
    ...(model === undefined ? [] : ['    config:', '      model: ' + model]),
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

/** Runs one task over a stub provider and records the routes it was asked for. */
const runWith = async (
  model: string | undefined,
  overrides: Partial<CommandOptions>,
): Promise<{ code: number; seen: Array<string>; err: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'jozo-harness-route-'))
  const seen: Array<string> = []
  const err: Array<string> = []
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
        stream: (request) => {
          seen.push(request.provider + '/' + request.model)
          return Stream.fromIterable(reply)
        },
      } satisfies LlmAdapter),
  }
  const code = await Effect.runPromise(
    runCommand({
      profiles: [profile(root, model)],
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
      route: '',
      task: 'go',
      stdout: () => undefined,
      stderr: (text) => void err.push(text),
      ...overrides,
    }),
  )
  await rm(root, { recursive: true, force: true })
  return { code, seen, err: err.join('') }
}

describe('route resolution', () => {
  test('a row config supplies the route when no route option is given', async () => {
    const { code, seen } = await runWith('profile/model', {})

    expect(code).toBe(0)
    expect(seen).toEqual(['profile/model'])
  })

  test('the route option wins over the row', async () => {
    const { code, seen } = await runWith('profile/model', { route: 'option/model' })

    expect(code).toBe(0)
    expect(seen).toEqual(['option/model'])
  })

  test('without any route the run stops before the provider', async () => {
    const { code, seen, err } = await runWith(undefined, {})

    expect(code).toBe(1)
    expect(seen).toEqual([])
    expect(err).toBe(
      'jzh: no model is set: run jzh config set model <provider/model>, or pass --model for one run (jzh models lists them)\n',
    )
  })
})
