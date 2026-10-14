import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { safetyPlugin, type ApprovalRequested } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { tier0Plugin } from '@fudo/tools-tier0'
import { toolsPlugin } from '@fudo/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
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
    '      preset: ' + preset,
    // These tests watch the permission preset, not the sandbox: run as they are.
    '      sandbox: none',
    '  - id: tier0',
    "    name: '@fudo/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

const run = async (
  preset: string,
  approve: (request: ApprovalRequested) => Effect.Effect<boolean>,
) => {
  const root = await mkdtemp(join(tmpdir(), 'fudo-approve-'))
  const workspace = await mkdtemp(join(tmpdir(), 'fudo-ws-'))
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
  test('workspace-write asks before bash and the refusal stops it', async () => {
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
    expect(asked.map((request) => request.tool)).toEqual(['bash'])
    expect(asked[0]?.reason).toBe('preset workspace-write does not allow: exec')
    expect(types).toContain('safety/approval/requested')
    expect(types).toContain('safety/approval/answered')
    expect(result?.type === 'tool/result' ? result.data.isError : false).toBe(true)
  })

  test('full runs the same call without asking', async () => {
    const asked: Array<ApprovalRequested> = []
    const observed = await run('full', (request) =>
      Effect.sync(() => {
        asked.push(request)
        return true
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
})
