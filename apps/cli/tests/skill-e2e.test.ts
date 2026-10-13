import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { tier1Plugin } from '@fudo/tools-tier1'
import { toolsPlugin } from '@fudo/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const callSkill: ReadonlyArray<StreamChunk> = [
  {
    type: 'block-end',
    index: 0,
    block: {
      type: 'tool-call',
      id: 'c1',
      name: 'skill',
      arguments: JSON.stringify({ name: 'demo' }),
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
        const scripts = [callSkill, textTurn('done')]
        const script = scripts[call] ?? []
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
    '  - id: tier1',
    "    name: '@fudo/tools-tier1'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('skill through the command', () => {
  test('the skill body reaches the model as the tool result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-skill-'))
    const skills = await mkdtemp(join(tmpdir(), 'fudo-skills-'))
    const MARKER = 'SKILL-BODY-MARKER'
    await Bun.write(join(skills, 'demo', 'SKILL.md'), MARKER + '\nstep one\n')

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
          tier1Plugin,
          stubLlm,
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: '/tmp',
        route: 'stub/model',
        task: 'use the demo skill',
        skills: [skills],
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))
    const result = opened.events.find((event) => event.type === 'tool/result')

    expect(result?.type === 'tool/result' ? result.data.isError : true).toBe(false)
    expect(JSON.stringify(result)).toContain(MARKER)
    await rm(root, { recursive: true, force: true })
    await rm(skills, { recursive: true, force: true })
  })
})
