import { describe, expect, test } from 'bun:test'
import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { sessionPlugin } from '@fudo/session'
import { sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
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
    '  - id: llm',
    '    name: stub-llm',
    ...(model === undefined ? [] : ['    config:', '      model: ' + model]),
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

/** Runs one task over a stub provider and records the routes it was asked for. */
const runWith = async (
  model: string | undefined,
  overrides: Partial<CommandOptions>,
): Promise<{ code: number; seen: Array<string>; err: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'fudo-route-'))
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
      'fudo: no model is set: pass --model provider/model or set model in the settings file (fudo models lists them)\n',
    )
  })
})
