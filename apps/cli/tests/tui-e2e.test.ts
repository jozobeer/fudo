import { describe, expect, test } from 'bun:test'
import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { tier0Plugin } from '@fudo/tools-tier0'
import { toolsPlugin } from '@fudo/tools'
import type { KeyEvent, TuiIo } from '@fudo/tui'
import { Effect, Layer, Schedule, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCommand } from '../src/index.ts'

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const callBash: ReadonlyArray<StreamChunk> = [
  {
    type: 'block-end',
    index: 0,
    block: { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{"command":"echo ran"}' },
  },
  { type: 'finish', kind: 'tool-calls' },
]

const stubLlm = (scripts: ReadonlyArray<ReadonlyArray<StreamChunk>>): Plugin<{}, Llm, never> => ({
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
        const script = scripts[call] ?? textTurn('nothing left')
        call += 1
        return Stream.fromIterable(script)
      },
    } satisfies LlmAdapter)
  },
})

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
    // The TUI test drives a bash call; the sandbox has its own test.
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

const char = (value: string): KeyEvent => ({ kind: 'char', char: value })
const enter: KeyEvent = { kind: 'enter' }
const ctrlD: KeyEvent = { kind: 'ctrl', char: 'd' }
const typed = (text: string): ReadonlyArray<KeyEvent> => [...text].map(char)

const later = (key: KeyEvent, millis: number): Stream.Stream<KeyEvent> =>
  Stream.fromEffect(Effect.sleep(millis)).pipe(Stream.map(() => key))

const spaced = (keys: ReadonlyArray<KeyEvent>): Stream.Stream<KeyEvent> =>
  Stream.fromIterable(keys).pipe(Stream.schedule(Schedule.spaced('15 millis')))

const keyStream = (...parts: ReadonlyArray<Stream.Stream<KeyEvent>>): Stream.Stream<KeyEvent> =>
  parts.reduce((left, right) => Stream.concat(left, right))

interface FakeTui {
  readonly io: TuiIo
  readonly writes: Array<string>
  readonly raw: Array<boolean>
}

const fakeTui = (keys: Stream.Stream<KeyEvent>): FakeTui => {
  const writes: Array<string> = []
  const raw: Array<boolean> = []
  return {
    io: {
      size: () => ({ columns: 60, rows: 12 }),
      keys,
      resizes: Stream.empty,
      write: (text) => writes.push(text),
      setRaw: (on) => raw.push(on),
    },
    writes,
    raw,
  }
}

const screenOf = (tui: FakeTui): string => tui.writes.join('')

describe('terminal UI through the command', () => {
  test('a typed line becomes a turn and the reply is drawn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-tui-'))
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-tui-ws-'))
    const tui = fakeTui(keyStream(spaced(typed('hi')), spaced([enter]), later(ctrlD, 250)))

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root, 'full')],
        plugins: plugins(stubLlm([textTurn('ok')])),
        cwd: workspace,
        route: 'stub/model',
        tui: tui.io,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    const screen = screenOf(tui)
    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))

    expect(code).toBe(0)
    expect(screen).toContain('hi')
    expect(screen).toContain('ok')
    expect(tui.raw).toEqual([true, false])
    expect(
      opened.events.flatMap((event) =>
        event.type === 'user/message' && event.data.source === 'user' ? [event.data.text] : [],
      ),
    ).toEqual(['hi'])
    expect(opened.events.filter((event) => event.type === 'turn/end')).toHaveLength(1)
    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  test('an approval is answered from the keyboard and the tool runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-tui-'))
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-tui-ws-'))
    const tui = fakeTui(
      keyStream(spaced(typed('run')), spaced([enter]), later(char('y'), 300), later(ctrlD, 500)),
    )

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root, 'workspace-write')],
        plugins: plugins(stubLlm([callBash, textTurn('all done')])),
        cwd: workspace,
        route: 'stub/model',
        tui: tui.io,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    const screen = screenOf(tui)
    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))
    const asked = opened.events.find((event) => event.type === 'safety/approval/requested')
    const answered = opened.events.find((event) => event.type === 'safety/approval/answered')
    const result = opened.events.find((event) => event.type === 'tool/result')

    expect(code).toBe(0)
    expect(screen).toContain('[y/n]')
    expect(screen).toContain('all done')
    expect(asked?.type).toBe('safety/approval/requested')
    expect(answered?.type === 'safety/approval/answered' ? answered.data.approved : false).toBe(
      true,
    )
    expect(result?.type === 'tool/result' ? result.data.isError : true).toBe(false)
    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  test('resume draws the earlier conversation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-tui-'))
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-tui-ws-'))
    const first = await Effect.runPromise(
      runCommand({
        profiles: [profile(root, 'full')],
        plugins: plugins(stubLlm([textTurn('first reply')])),
        cwd: workspace,
        route: 'stub/model',
        task: 'remember this',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(first).toBe(0)
    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const id = sessions[0]?.id ?? ''

    const tui = fakeTui(keyStream(later(ctrlD, 150)))
    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root, 'full')],
        plugins: plugins(stubLlm([])),
        cwd: workspace,
        route: 'stub/model',
        resume: id,
        tui: tui.io,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    expect(code).toBe(0)
    expect(screenOf(tui)).toContain('remember this')
    expect(screenOf(tui)).toContain('first reply')
    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })
})
