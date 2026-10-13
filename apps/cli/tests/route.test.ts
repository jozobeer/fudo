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
import { runCommand } from '../src/index.ts'

const reply: ReadonlyArray<StreamChunk> = [
  { type: 'text-delta', index: 0, text: 'ok' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } },
  { type: 'finish', kind: 'stop' },
]

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
    '  - id: llm',
    '    name: stub-llm',
    '    config:',
    '      model: profile/model',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('route from the profile', () => {
  test('a row config supplies the route when no route option is given', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-route-'))
    const seen: Array<{ provider: string; model: string }> = []
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
            seen.push({ provider: request.provider, model: request.model })
            return Stream.fromIterable(reply)
          },
        } satisfies LlmAdapter),
    }

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
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
        stderr: () => undefined,
      }),
    )

    expect(code).toBe(0)
    expect(seen).toEqual([{ provider: 'profile', model: 'model' }])
    await rm(root, { recursive: true, force: true })
  })
})
