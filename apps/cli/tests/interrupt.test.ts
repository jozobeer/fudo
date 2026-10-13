import { describe, expect, test } from 'bun:test'
import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter } from '@fudo/llm'
import { sessionPlugin } from '@fudo/session'
import { sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCommand } from '../src/index.ts'

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
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('interrupt', () => {
  test('a cancellation request stops the turn and exits 130', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-interrupt-'))
    const silent: Plugin<{}, Llm, never> = {
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
          stream: () => Stream.never,
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
          silent,
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: '/work',
        route: 'stub/model',
        task: 'go',
        interrupt: Effect.sleep('20 millis'),
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    expect(code).toBe(130)
    await rm(root, { recursive: true, force: true })
  })
})
