import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { safetyPlugin, type ApprovalRequested } from '@jozo-harness/safety'
import { sessionPlugin } from '@jozo-harness/session'
import { jsonlSessions, sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { tier0Plugin } from '@jozo-harness/tools-tier0'
import { toolsPlugin } from '@jozo-harness/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { runCommand } from '../src/index.ts'

const callBash: ReadonlyArray<StreamChunk> = [
  {
    type: 'block-end',
    index: 0,
    block: { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"command":"echo ran"}' },
  },
  { type: 'finish', kind: 'tool-calls' },
]

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const stubLlm: Plugin<{}, Llm, never> = {
  name: 'stub-llm',
  config: Schema.Struct({}),
  provides: [Llm],
  requires: [],
  layer: () => {
    let call = 0
    return Layer.succeed(Llm, {
      name: 'stub',
      capabilities: {
        toolChoice: false,
        reasoningEffort: null,
        images: 'none',
        promptCacheControl: false,
      },
      stream: () => {
        const scripts = [callBash, textTurn('all done')]
        const script = scripts[call] ?? []
        call += 1
        return Stream.fromIterable(script)
      },
    } satisfies LlmAdapter)
  },
}

const profile = (root: string, preset: string): string =>
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
    '  - id: safety',
    "    name: '@jozo-harness/safety'",
    '    config:',
    '      preset: ' + preset,
    // The boundary these tests watch is the sandbox; a run with none is the
    // unconfined one, so what a preset does to an ordinary call shows here.
    '      sandbox: none',
    '  - id: tier0',
    "    name: '@jozo-harness/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

const run = async (
  preset: string,
  approve: (request: ApprovalRequested) => Effect.Effect<boolean>,
) => {
  const root = await mkdtemp(join(tmpdir(), 'jozo-harness-approve-'))
  const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-ws-'))
  const code = await Effect.runPromise(
    runCommand({
      profiles: [profile(root, preset)],
      plugins: [
        kernelPlugin,
        sessionJsonlPlugin,
        sessionPlugin,
        toolsPlugin,
        systemPromptPlugin,
        safetyPlugin,
        tier0Plugin,
        stubLlm,
        agentPlugin,
        agentLoopPlugin,
      ] as ReadonlyArray<Plugin<any, any, any>>,
      cwd: workspace,
      route: 'stub/model',
      task: 'run the command',
      approve,
      stdout: () => undefined,
      stderr: () => undefined,
    }),
  )
  const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
  const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))
  await rm(root, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
  return { code, events: opened.events }
}

describe('approval through the command', () => {
  test('workspace-write runs a bash call without asking', async () => {
    const asked: Array<ApprovalRequested> = []
    const observed = await run('workspace-write', (request) =>
      Effect.sync(() => {
        asked.push(request)
        return false
      }),
    )

    const types = observed.events.map((event) => event.type)
    const result = observed.events.find((event) => event.type === 'tool/result')

    expect(observed.code).toBe(0)
    expect(asked).toEqual([])
    expect(types).not.toContain('safety/approval/requested')
    expect(result?.type === 'tool/result' ? result.data.isError : true).toBe(false)
    expect(JSON.stringify(result)).toContain('ran')
  })

  test('read-only runs the call too: the sandbox, not the preset, is the boundary', async () => {
    const asked: Array<ApprovalRequested> = []
    const observed = await run('read-only', (request) =>
      Effect.sync(() => {
        asked.push(request)
        return false
      }),
    )

    const result = observed.events.find((event) => event.type === 'tool/result')

    expect(observed.code).toBe(0)
    expect(asked).toEqual([])
    expect(result?.type === 'tool/result' ? result.data.isError : true).toBe(false)
    expect(JSON.stringify(result)).toContain('ran')
  })
})
