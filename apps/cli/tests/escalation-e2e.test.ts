import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { Policy, Sandbox, type ApprovalRequested, type SandboxShape } from '@jozo-harness/safety'
import { sessionPlugin } from '@jozo-harness/session'
import { jsonlSessions, sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { tier0Plugin } from '@jozo-harness/tools-tier0'
import { toolsPlugin } from '@jozo-harness/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

/**
 * A sandbox that refuses every command the way seatbelt refuses a file effect.
 * The wider mode runs the command as it is, which is what an unconfined provider
 * does — a real seatbelt cannot be nested inside the sandbox these tests run in.
 */
const confiningSandbox: SandboxShape = {
  name: 'test-confine',
  confines: true,
  mode: 'workspace-write',
  wrap: (command) => {
    const mode = command.mode ?? 'workspace-write'
    if (mode !== 'workspace-write') {
      return Effect.succeed({ argv: command.argv, cwd: command.cwd, mode, denialSignatures: [] })
    }
    return Effect.succeed({
      argv: [
        'bash',
        '-lc',
        'printf "%s\\n" "bash: /etc/hosts: Operation not permitted" >&2; exit 1',
      ],
      cwd: command.cwd,
      mode,
      denialSignatures: ['operation not permitted'],
    })
  },
}

/** Stands in for the safety row: the same services, a sandbox that always denies. */
const testSafety: Plugin<{}, Policy | Sandbox, never> = {
  name: 'test-safety',
  config: Schema.Struct({}),
  provides: [Policy, Sandbox],
  requires: [],
  layer: () =>
    Layer.merge(
      Layer.succeed(Policy, { preset: 'workspace-write', mode: 'workspace-write' }),
      Layer.succeed(Sandbox, confiningSandbox),
    ),
}

const attempt: ReadonlyArray<StreamChunk> = [
  {
    type: 'block-end',
    index: 0,
    block: {
      type: 'tool-call',
      id: 'c1',
      name: 'bash',
      arguments: '{"command":"echo escalated ok"}',
    },
  },
  { type: 'finish', kind: 'tool-calls' },
]

const retry: ReadonlyArray<StreamChunk> = [
  {
    type: 'block-end',
    index: 0,
    block: {
      type: 'tool-call',
      id: 'c2',
      name: 'bash',
      arguments: JSON.stringify({
        command: 'echo escalated ok',
        sandbox_permissions: 'danger-full-access',
        justification: 'the command writes outside the workspace',
      }),
    },
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
        const script = [attempt, retry, textTurn('the retry ran')][call] ?? []
        call += 1
        return Stream.fromIterable(script)
      },
    } satisfies LlmAdapter)
  },
}

const profile = (root: string): string =>
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
    '    name: test-safety',
    '  - id: tier0',
    "    name: '@jozo-harness/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

const run = async (approved: boolean) => {
  const root = await mkdtemp(join(tmpdir(), 'jozo-harness-escalate-'))
  const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-escalate-ws-'))
  const asked: Array<ApprovalRequested> = []
  const code = await Effect.runPromise(
    runCommand({
      profiles: [profile(root)],
      plugins: [
        kernelPlugin,
        sessionJsonlPlugin,
        sessionPlugin,
        toolsPlugin,
        systemPromptPlugin,
        testSafety,
        tier0Plugin,
        stubLlm,
        agentPlugin,
        agentLoopPlugin,
      ] as ReadonlyArray<Plugin<any, any, any>>,
      cwd: workspace,
      route: 'stub/model',
      task: 'write the file',
      approve: (request) =>
        Effect.sync(() => {
          asked.push(request)
          return approved
        }),
      stdout: () => undefined,
      stderr: () => undefined,
    }),
  )
  const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
  const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))
  await rm(root, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
  return { code, asked, events: opened.events }
}

/** What one tool result carried, as the log wrote it. */
interface ToolResultData {
  readonly isError: boolean
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>
}

const textOf = (result: ToolResultData): string =>
  result.content.flatMap((block) => (block.type === 'text' ? [block.text ?? ''] : [])).join('')

const resultsOf = (events: ReadonlyArray<{ readonly type: string; readonly data: unknown }>) =>
  events.flatMap((event) => (event.type === 'tool/result' ? [event.data as ToolResultData] : []))

describe('escalation through the command', () => {
  test('a denied command is reported, and an approved retry runs wider', async () => {
    const observed = await run(true)
    const results = resultsOf(observed.events)

    expect(observed.code).toBe(0)
    expect(results).toHaveLength(2)
    // The denial names the mode, and the hint names the sanctioned retry.
    const denied = textOf(results[0] as ToolResultData)
    expect(denied).toContain('[sandbox: file access denied under workspace-write mode]')
    expect(denied).toContain('sandbox_permissions')
    // The retry ran the command for real, under the mode the human allowed.
    expect(results[1]?.isError).toBe(false)
    expect(textOf(results[1] as ToolResultData)).toContain('escalated ok')

    const types = observed.events.map((event) => event.type)
    expect(types).toContain('safety/approval/requested')
    expect(types).toContain('safety/approval/answered')
    expect(observed.asked).toHaveLength(1)
    expect(observed.asked[0]?.reason).toContain('danger-full-access')
    const answered = observed.events.find((event) => event.type === 'safety/approval/answered')
    expect(answered?.data.approved).toBe(true)
  })

  test('a refusal is recorded and the retry never runs', async () => {
    const observed = await run(false)
    const results = resultsOf(observed.events)

    expect(observed.code).toBe(0)
    expect(results[1]?.isError).toBe(true)
    expect(textOf(results[1] as ToolResultData)).toContain('rejected')
    expect(textOf(results[1] as ToolResultData)).not.toContain('escalated ok')
    const answered = observed.events.find((event) => event.type === 'safety/approval/answered')
    expect(answered?.data.approved).toBe(false)
  })
})
