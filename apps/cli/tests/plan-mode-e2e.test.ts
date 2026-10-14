import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { tier0Plugin } from '@fudo/tools-tier0'
import { tier1Plugin } from '@fudo/tools-tier1'
import { toolsPlugin } from '@fudo/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const toolTurn = (name: string, args: unknown): ReadonlyArray<StreamChunk> => [
  {
    type: 'block-end',
    index: 0,
    block: { type: 'tool-call', id: 'c-' + name, name, arguments: JSON.stringify(args) },
  },
  { type: 'finish', kind: 'tool-calls' },
]

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const profile = (root: string, planMode: boolean): string =>
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
    '      planMode: ' + String(planMode),
    '  - id: ask',
    "    name: '@fudo/ask'",
    '  - id: tier0',
    "    name: '@fudo/tools-tier0'",
    '  - id: tier1',
    "    name: '@fudo/tools-tier1'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

const run = async (planMode: boolean) => {
  const root = await mkdtemp(join(tmpdir(), 'fudo-plan-'))
  const offered: Array<string> = []
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
          for (const schema of request.tools ?? []) offered.push(schema.name)
          return Stream.fromIterable(textTurn('ok'))
        },
      } satisfies LlmAdapter),
  }

  const code = await Effect.runPromise(
    runCommand({
      profiles: [profile(root, planMode)],
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
        stub,
        agentPlugin,
        agentLoopPlugin,
      ] as ReadonlyArray<Plugin<any, any, any>>,
      cwd: '/tmp',
      route: 'stub/model',
      task: 'plan something',
      stdout: () => undefined,
      stderr: () => undefined,
    }),
  )
  await rm(root, { recursive: true, force: true })
  return { code, offered }
}

describe('plan mode through the command', () => {
  test('the model is offered only the read-only tools', async () => {
    const observed = await run(true)

    expect(observed.code).toBe(0)
    expect(observed.offered).toContain('read')
    expect(observed.offered).toContain('todo_write')
    expect(observed.offered).not.toContain('write')
    expect(observed.offered).not.toContain('bash')
    expect(observed.offered).not.toContain('edit')
  })

  test('without plan mode every tool is offered', async () => {
    const observed = await run(false)

    expect(observed.offered).toContain('write')
    expect(observed.offered).toContain('bash')
  })

  test('an approved plan brings the workspace tools back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-plan-'))
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-plan-ws-'))
    const offered: Array<ReadonlyArray<string>> = []
    let step = 0
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
            offered.push((request.tools ?? []).map((schema) => schema.name))
            step += 1
            if (step === 1) {
              return Stream.fromIterable(
                toolTurn('exit_plan_mode', { plan: '1. write out.txt with the answer' }),
              )
            }
            if (step === 2) {
              return Stream.fromIterable(
                toolTurn('write', { path: 'out.txt', content: 'the answer\n' }),
              )
            }
            return Stream.fromIterable(textTurn('done'))
          },
        } satisfies LlmAdapter),
    }

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root, true)],
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
          stub,
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: workspace,
        route: 'stub/model',
        task: 'plan, then do it',
        answer: () => Effect.succeed('approve'),
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    // While the plan is still a plan, the model cannot write.
    expect(offered[0]).not.toContain('write')
    expect(offered[0]).toContain('exit_plan_mode')
    // The approval ends plan mode, and the very next call could write.
    expect(code).toBe(0)
    expect(offered[1]).toContain('write')
    expect(await Bun.file(join(workspace, 'out.txt')).text()).toBe('the answer\n')

    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })
})
