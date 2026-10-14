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
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand, type CommandOptions } from '../src/index.ts'

const reply = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const stubLlm = (): Plugin<{}, Llm, never> => ({
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
      stream: () => Stream.fromIterable(reply('ok')),
    } satisfies LlmAdapter),
})

/** The rows a profile names, with or without the Tier 1 tools. */
const profile = (root: string, name: string, withTier1: boolean): string =>
  [
    'name: ' + name,
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
    '  - id: tier0',
    "    name: '@fudo/tools-tier0'",
    ...(withTier1 ? ['  - id: tier1', "    name: '@fudo/tools-tier1'"] : []),
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

const plugins = (withTier1: boolean): ReadonlyArray<Plugin<any, any, any>> => [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  safetyPlugin,
  askPlugin,
  tier0Plugin,
  ...(withTier1 ? [tier1Plugin] : []),
  stubLlm(),
  agentPlugin,
  agentLoopPlugin,
]

const run = (
  options: Partial<CommandOptions> & { readonly profile: string; readonly tier1: boolean },
): Promise<{ readonly code: number; readonly stderr: string }> => {
  const errs: Array<string> = []
  return Effect.runPromise(
    runCommand({
      profiles: [options.profile],
      plugins: plugins(options.tier1),
      cwd: '/tmp',
      route: 'stub/model',
      stdout: () => undefined,
      stderr: (text) => {
        errs.push(text)
      },
      ...options,
    }),
  ).then((code) => ({ code, stderr: errs.join('') }))
}

const sessionOf = async (root: string, resume: string) => {
  const opened = await Effect.runPromise(jsonlSessions({ root }).open(resume))
  return opened.events
}

describe('the composition a session was started with', () => {
  test('is recorded, and a resume under a different one is refused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-preset-'))
    const full = profile(root, 'full', true)
    const small = profile(root, 'small', false)

    const first = await run({ profile: full, tier1: true, task: 'first' })
    expect(first.code).toBe(0)
    const listed = await Effect.runPromise(jsonlSessions({ root }).list())
    const id = listed[0]?.id ?? ''
    const after = await sessionOf(root, id)
    const recorded = after.flatMap((event) =>
      event.type === 'preset/selected' ? [event.data] : [],
    )

    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ profiles: ['full'] })
    expect(recorded[0]?.tools).toContain('write')
    expect(recorded[0]?.tools).toContain('todo_write')

    // The smaller composition is missing the tier 1 tools: refuse before any turn.
    const refused = await run({ profile: small, tier1: false, resume: id, task: 'second' })
    const stillOne = await sessionOf(root, id)

    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('profiles: full -> small')
    expect(refused.stderr).toContain('tools gone:')
    expect(refused.stderr).toContain('--allow-preset-change')
    expect(stillOne.filter((event) => event.type === 'turn/start')).toHaveLength(1)

    // The same composition continues the session.
    const same = await run({ profile: full, tier1: true, resume: id, task: 'third' })
    expect(same.code).toBe(0)

    // And a deliberate change is recorded as the session's new composition.
    const changed = await run({
      profile: small,
      tier1: false,
      resume: id,
      task: 'fourth',
      allowPresetChange: true,
    })
    const after4 = await sessionOf(root, id)

    expect(changed.code).toBe(0)
    expect(after4.filter((event) => event.type === 'turn/start')).toHaveLength(3)
    expect(
      after4.flatMap((event) => (event.type === 'preset/selected' ? [event.data.profiles] : [])),
    ).toEqual([['full'], ['small']])

    await rm(root, { recursive: true, force: true })
  })
})
