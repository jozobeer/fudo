import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { tier0Plugin } from '@fudo/tools-tier0'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const stubLlm = (script: ReadonlyArray<StreamChunk>): Plugin<{}, Llm, never> => ({
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
      stream: () => Stream.fromIterable(script),
    } satisfies LlmAdapter),
})

/** Tier 0 only, so the guidance of Tier 1 must stay out of the prompt. */
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
    '      preset: workspace-write',
    '  - id: tier0',
    "    name: '@fudo/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('the system prompt through the command', () => {
  test('the model receives the identity and the guidance of its own tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-prompt-'))
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-ws-'))

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
          stubLlm(textTurn('done')),
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: workspace,
        route: 'stub/model',
        task: 'say done',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))
    const system = opened.events.find((event) => event.type === 'system/message')
    const text = system?.type === 'system/message' ? system.data.text : ''

    expect(text).toContain('You are an AI coding agent powered by fudo.')
    expect(text).toContain('Use read instead of cat')
    expect(text).toContain('Check the [exit code: N] marker')
    // Tier 1 is not in this profile, so its guidance must not appear.
    expect(text).not.toContain('todo_write')

    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })
})
