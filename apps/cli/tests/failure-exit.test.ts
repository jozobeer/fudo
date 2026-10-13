import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, LlmFailure, type LlmAdapter } from '@fudo/llm'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const failing: Plugin<{}, Llm, never> = {
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
      stream: () =>
        Stream.fail(new LlmFailure({ code: 'AUTH', message: 'no API key is configured' })),
    } satisfies LlmAdapter),
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
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('a turn that fails', () => {
  test('is reported on stderr and exits 1', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-fail-'))
    const err: Array<string> = []

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
          failing,
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: '/tmp',
        route: 'stub/model',
        task: 'say something',
        stdout: () => undefined,
        stderr: (text) => void err.push(text),
      }),
    )

    expect({ code, stderr: err.join('') }).toEqual({
      code: 1,
      stderr: 'fudo: the turn failed: AUTH: no API key is configured\n',
    })
    await rm(root, { recursive: true, force: true })
  })

  test('a completed turn still exits 0', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-ok-'))
    const ok: Plugin<{}, Llm, never> = {
      ...failing,
      layer: () =>
        Layer.succeed(Llm, {
          name: 'stub',
          capabilities: {
            toolChoice: false,
            reasoningEffort: null,
            images: 'none',
            promptCacheControl: false,
          },
          stream: () =>
            Stream.fromIterable([
              { type: 'text-delta' as const, index: 0, text: 'fine' },
              {
                type: 'block-end' as const,
                index: 0,
                block: { type: 'text' as const, text: 'fine' },
              },
              { type: 'finish' as const, kind: 'stop' as const },
            ]),
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
          safetyPlugin,
          askPlugin,
          ok,
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: '/tmp',
        route: 'stub/model',
        task: 'say something',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    expect(code).toBe(0)
    await rm(root, { recursive: true, force: true })
  })
})
