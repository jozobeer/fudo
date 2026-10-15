import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { safetyPlugin } from '@jozo-harness/safety'
import { sessionPlugin } from '@jozo-harness/session'
import { jsonlSessions, sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { toolsPlugin } from '@jozo-harness/tools'
import { tier0Plugin } from '@jozo-harness/tools-tier0'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const MARKER = 'AGENTS-MD-MARKER-4711'
const NESTED_MARKER = 'NESTED-AGENTS-MARKER-8142'
const HOME_MARKER = 'HOME-AGENTS-MARKER-3390'
const TAIL_MARKER = 'TAIL-AGENTS-MARKER-6021'
const CLAUDE_MARKER = 'CLAUDE-MD-MARKER-5507'

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const callRead = (path: string): ReadonlyArray<StreamChunk> => [
  {
    type: 'block-end',
    index: 0,
    block: { type: 'tool-call', id: 'c1', name: 'read', arguments: JSON.stringify({ path }) },
  },
  { type: 'finish', kind: 'tool-calls' },
]

/** Every request the model made, as the text of the messages it received. */
const stubLlm = (scripts: ReadonlyArray<ReadonlyArray<StreamChunk>>, seen: Array<string>) => {
  let call = 0
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
        stream: (request) => {
          seen.push(
            request.messages
              .flatMap((message) => message.content)
              .flatMap((block) => (block.type === 'text' ? [block.text] : []))
              .join('\n'),
          )
          const script = scripts[call] ?? []
          call += 1
          return Stream.fromIterable(script)
        },
      } satisfies LlmAdapter),
  } satisfies Plugin<{}, Llm, never>
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
    "    name: '@jozo-harness/safety'",
    '    config:',
    '      preset: full',
    '  - id: tier0',
    "    name: '@jozo-harness/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

const plugins = (llm: Plugin<{}, Llm, never>): ReadonlyArray<Plugin<any, any, any>> => [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  safetyPlugin,
  tier0Plugin,
  llm,
  agentPlugin,
  agentLoopPlugin,
]

describe('workspace instructions', () => {
  test('AGENTS.md reaches the model request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-md-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-ws-'))
    await Bun.write(join(workspace, 'AGENTS.md'), MARKER + '\n')
    const seen: Array<string> = []

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins: plugins(stubLlm([textTurn('ok')], seen)),
        cwd: workspace,
        route: 'stub/model',
        task: 'say ok',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    expect(code).toBe(0)
    expect(seen.join('\n')).toContain(MARKER)
    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  test('a workspace with only CLAUDE.md still reaches the model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-md-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-ws-'))
    await Bun.write(join(workspace, 'CLAUDE.md'), CLAUDE_MARKER + '\n')
    const seen: Array<string> = []

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins: plugins(stubLlm([textTurn('ok')], seen)),
        cwd: workspace,
        route: 'stub/model',
        task: 'say ok',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    expect(code).toBe(0)
    expect(seen.join('\n')).toContain(CLAUDE_MARKER)
    expect(seen.join('\n')).toContain('Instructions from ' + join(workspace, 'CLAUDE.md'))
    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  test('a nested AGENTS.md reaches the model once a tool touches its directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-md-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-ws-'))
    const nested = join(workspace, 'packages', 'foo')
    await mkdir(nested, { recursive: true })
    await Bun.write(join(workspace, 'AGENTS.md'), MARKER + '\n')
    await Bun.write(join(nested, 'AGENTS.md'), NESTED_MARKER + '\n')
    await Bun.write(join(nested, 'notes.txt'), 'the notes\n')
    const seen: Array<string> = []

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins: plugins(stubLlm([callRead('packages/foo/notes.txt'), textTurn('done')], seen)),
        cwd: workspace,
        route: 'stub/model',
        task: 'read the notes',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    // The first request knows only the root file; the file that applies to the
    // directory the tool touched arrives with the next request.
    expect(seen[0]).toContain(MARKER)
    expect(seen[0]).not.toContain(NESTED_MARKER)
    expect(seen[1]).toContain('Additional instructions from: ' + join(nested, 'AGENTS.md'))
    expect(seen[1]).toContain(NESTED_MARKER)

    const opened = await Effect.runPromise(
      jsonlSessions({ root }).open(
        (await Effect.runPromise(jsonlSessions({ root }).list()))[0]?.id ?? '',
      ),
    )
    expect(
      opened.events.some(
        (event) => event.type === 'user/message' && event.data.source === 'inject',
      ),
    ).toBe(true)

    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  test('a huge AGENTS.md is cut inside the budget and the model is told', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-md-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-ws-'))
    await Bun.write(join(workspace, 'AGENTS.md'), 'filler line\n'.repeat(6000) + TAIL_MARKER + '\n')
    const seen: Array<string> = []

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins: plugins(stubLlm([textTurn('ok')], seen)),
        cwd: workspace,
        route: 'stub/model',
        task: 'say ok',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    expect(code).toBe(0)
    expect(seen[0]).toContain('Workspace instruction budget 65536 bytes: truncated')
    expect(seen[0]).not.toContain(TAIL_MARKER)
    // The section ends where the runtime snapshot that follows it begins.
    const all = seen[0] ?? ''
    const start = all.indexOf('Instructions from ')
    const end = all.indexOf('\nCurrent runtime context:', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(
      Buffer.byteLength(all.slice(start, end < 0 ? undefined : end), 'utf8'),
    ).toBeLessThanOrEqual(65536)

    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  test('the home AGENTS.md renders before the workspace one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-md-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-ws-'))
    const home = await mkdtemp(join(tmpdir(), 'jozo-harness-home-'))
    await Bun.write(join(home, 'AGENTS.md'), HOME_MARKER + '\n')
    await Bun.write(join(workspace, 'AGENTS.md'), MARKER + '\n')
    const seen: Array<string> = []

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins: plugins(stubLlm([textTurn('ok')], seen)),
        cwd: workspace,
        route: 'stub/model',
        task: 'say ok',
        jzhHome: home,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    expect(code).toBe(0)
    const text = seen[0] ?? ''
    expect(text.indexOf(HOME_MARKER)).toBeGreaterThanOrEqual(0)
    expect(text.indexOf(HOME_MARKER)).toBeLessThan(text.indexOf(MARKER))

    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  })
})
