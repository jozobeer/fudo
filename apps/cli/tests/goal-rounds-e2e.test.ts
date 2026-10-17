import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { askPlugin, safetyPlugin } from '@jozo-harness/safety'
import { sessionPlugin } from '@jozo-harness/session'
import { jsonlSessions, sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { toolsPlugin } from '@jozo-harness/tools'
import { tier0Plugin } from '@jozo-harness/tools-tier0'
import { tier1Plugin } from '@jozo-harness/tools-tier1'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { runCommand } from '../src/index.ts'

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const goalTurn = (args: unknown): ReadonlyArray<StreamChunk> => [
  {
    type: 'block-end',
    index: 0,
    block: { type: 'tool-call', id: 'c-goal', name: 'goal', arguments: JSON.stringify(args) },
  },
  { type: 'finish', kind: 'tool-calls' },
]

/** Plays the model: create the goal, then answer every round it is handed. */
const stubLlm = (
  rounds: ReadonlyArray<ReadonlyArray<StreamChunk>>,
  create: unknown,
): Plugin<{}, Llm, never> => {
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
          step += 1
          if (step === 1) return Stream.fromIterable(goalTurn(create))
          return Stream.fromIterable(rounds[step - 2] ?? textTurn('done'))
        },
      } satisfies LlmAdapter),
  }
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
    '  - id: ask',
    "    name: '@jozo-harness/ask'",
    '  - id: tier0',
    "    name: '@jozo-harness/tools-tier0'",
    '  - id: tier1',
    "    name: '@jozo-harness/tools-tier1'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

const run = async (
  create: unknown,
  rounds: ReadonlyArray<ReadonlyArray<StreamChunk>>,
): Promise<{
  code: number
  turns: number
  goalRounds: Array<string>
  goals: Array<unknown>
  results: Array<string>
}> => {
  const root = await mkdtemp(join(tmpdir(), 'jozo-harness-goal-'))
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
        tier0Plugin,
        tier1Plugin,
        stubLlm(rounds, create),
        agentPlugin,
        agentLoopPlugin,
      ] as ReadonlyArray<Plugin<any, any, any>>,
      cwd: '/tmp',
      route: 'stub/model',
      task: 'work on the objective',
      stdout: () => undefined,
      stderr: () => undefined,
    }),
  )
  const listed = await Effect.runPromise(jsonlSessions({ root }).list())
  const opened = await Effect.runPromise(jsonlSessions({ root }).open(listed[0]?.id ?? ''))
  const events = opened.events
  await rm(root, { recursive: true, force: true })
  return {
    code,
    turns: events.filter((event) => event.type === 'turn/start').length,
    goalRounds: events.flatMap((event) =>
      event.type === 'user/message' && event.data.source === 'goal-round' ? [event.data.text] : [],
    ),
    goals: events.flatMap((event) => (event.type === 'goal/updated' ? [event.data] : [])),
    results: events.flatMap((event) =>
      event.type === 'tool/result' ? [JSON.stringify(event.data.content)] : [],
    ),
  }
}

describe('a goal that keeps itself going through the command', () => {
  test('an active goal runs the next round on its own, and stops when completed', async () => {
    const observed = await run({ action: 'create', objective: 'finish the backlog' }, [
      // The rest of the turn that created the goal, then the round the driver queued.
      textTurn('started'),
      goalTurn({ action: 'complete' }),
      textTurn('done'),
    ])

    expect(observed.code).toBe(0)
    // The first turn created the goal; the second ran because the driver queued it.
    expect(observed.turns).toBe(2)
    expect(observed.goalRounds).toHaveLength(1)
    expect(observed.goalRounds[0]).toContain('Objective: finish the backlog')
    expect(observed.goalRounds[0]).toContain('Round: 1/256')
    expect(observed.goals.at(-1)).toMatchObject({ phase: 'complete' })
  })

  test('the model cannot pause its own goal from a round the driver started', async () => {
    const observed = await run(
      { action: 'create', objective: 'finish the backlog', maxGoalRounds: 1 },
      // The rest of the human turn that created the goal, then the queued round.
      [textTurn('started'), goalTurn({ action: 'pause' }), textTurn('still working')],
    )

    expect(observed.code).toBe(0)
    // The round asked to pause and was refused; the goal ran to its limit instead.
    expect(observed.results.some((text) => text.includes('needs a turn a human started'))).toBe(
      true,
    )
    expect(
      observed.goals.some((goal) => (goal as { readonly phase?: string }).phase === 'paused'),
    ).toBe(false)
    expect(observed.goals.at(-1)).toMatchObject({ phase: 'blocked' })
  })

  test('a goal that runs out of rounds is stopped instead of looping', async () => {
    const observed = await run(
      { action: 'create', objective: 'finish the backlog', maxGoalRounds: 1 },
      [textTurn('started'), textTurn('still working'), textTurn('done')],
    )

    expect(observed.code).toBe(0)
    expect(observed.turns).toBe(2)
    expect(observed.goalRounds).toHaveLength(1)
    expect(observed.goals.at(-1)).toMatchObject({ phase: 'blocked' })
    expect(JSON.stringify(observed.goals.at(-1))).toContain('round-limit')
  })
})
