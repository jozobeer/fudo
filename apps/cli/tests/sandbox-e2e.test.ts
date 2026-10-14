import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { tier0Plugin } from '@fudo/tools-tier0'
import { tier1Plugin } from '@fudo/tools-tier1'
import { Effect, Layer, Schema, Stream } from 'effect'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

/** A host that cannot apply a sandbox refuses every command it is wrapped in. */
const sandboxApplies = async (): Promise<boolean> => {
  const probe = Bun.spawn(['sandbox-exec', '-p', '(version 1)(allow default)', '--', 'true'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  return (await probe.exited) === 0
}

const applies = await sandboxApplies()

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const bashTurn = (command: string): ReadonlyArray<StreamChunk> => [
  {
    type: 'block-end',
    index: 0,
    block: {
      type: 'tool-call',
      id: 'c-bash',
      name: 'bash',
      arguments: JSON.stringify({ command }),
    },
  },
  { type: 'finish', kind: 'tool-calls' },
]

const stubLlm = (command: string): Plugin<{}, Llm, never> => {
  let step = 0
  return {
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
        stream: () => {
          const script = step === 0 ? bashTurn(command) : textTurn('done')
          step += 1
          return Stream.fromIterable(script)
        },
      } satisfies LlmAdapter),
  }
}

const profile = (root: string, workspace: string): string =>
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
    '      writableRoots:',
    '        - ' + workspace,
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

/** Runs one bash call through the command with whatever sandbox the profile gets. */
const runBash = async (command: string, workspace: string) => {
  const root = await mkdtemp(join(tmpdir(), 'fudo-sandbox-'))
  const code = await Effect.runPromise(
    runCommand({
      profiles: [profile(root, workspace)],
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
        stubLlm(command),
        agentPlugin,
        agentLoopPlugin,
      ] as ReadonlyArray<Plugin<any, any, any>>,
      cwd: workspace,
      route: 'stub/model',
      task: 'run it',
      stdout: () => undefined,
      stderr: () => undefined,
    }),
  )
  const listed = await Effect.runPromise(jsonlSessions({ root }).list())
  const opened = await Effect.runPromise(jsonlSessions({ root }).open(listed[0]?.id ?? ''))
  const results = opened.events.flatMap((event) =>
    event.type === 'tool/result'
      ? [
          {
            text: JSON.stringify(event.data.content),
            isError: event.data.isError === true,
          },
        ]
      : [],
  )
  await rm(root, { recursive: true, force: true })
  return { code, results }
}

describe('the sandbox a profile did not ask for', () => {
  test.skipIf(!applies)('keeps a command inside its workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-ws-'))
    const outside = resolve(
      import.meta.dir,
      '..',
      '..',
      '..',
      '.sandbox-probe-' + String(process.pid),
    )
    const observed = await runBash(
      'echo in > in.txt; echo out > ' + outside + '; echo done',
      workspace,
    )

    try {
      expect(observed.code).toBe(0)
      // Inside the workspace: written.
      expect(existsSync(join(workspace, 'in.txt'))).toBe(true)
      // Outside it: the sandbox said no, so nothing was written.
      expect(existsSync(outside)).toBe(false)
    } finally {
      await rm(outside, { force: true })
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test.skipIf(applies)('reports a sandbox the host refuses as a result, not a crash', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-ws-'))
    const observed = await runBash('echo hi', workspace)

    expect(observed.code).toBe(0)
    expect(observed.results).toHaveLength(1)
    // The call itself is not an error: the sandbox's refusal is what the command left behind.
    expect(observed.results[0]?.isError).toBe(false)
    expect(observed.results[0]?.text).toContain('sandbox')

    await rm(workspace, { recursive: true, force: true })
  })
})
