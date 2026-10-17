import { describe, expect, test } from 'bun:test'
import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { safetyPlugin } from '@jozo-harness/safety'
import { sessionPlugin } from '@jozo-harness/session'
import { jsonlSessions, sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { tier0Plugin } from '@jozo-harness/tools-tier0'
import { toolsPlugin } from '@jozo-harness/tools'
import type { KeyEvent, TuiIo } from '@jozo-harness/tui'
import { Effect, Layer, Schedule, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCommand } from '../src/index.ts'
import { testSafety } from './test-safety.ts'

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

/** The same command again, this time asking to run outside what denied it. */
const callBashWider: ReadonlyArray<StreamChunk> = [
  {
    type: 'block-end',
    index: 0,
    block: {
      type: 'tool-call',
      id: 'c2',
      name: 'bash',
      arguments: JSON.stringify({
        command: 'echo ran',
        sandbox_permissions: 'danger-full-access',
        justification: 'the command writes outside the workspace',
      }),
    },
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

/** The safety row of a test profile: the shipped plugin, or the sandbox that always denies. */
const safetyRow = (preset: string, kind: 'shipped' | 'denying'): ReadonlyArray<string> =>
  kind === 'denying'
    ? ['  - id: safety', '    name: test-safety']
    : [
        '  - id: safety',
        "    name: '@jozo-harness/safety'",
        '    config:',
        '      preset: ' + preset,
        // The TUI tests drive a bash call; the sandbox has its own test.
        '      sandbox: none',
      ]

const profile = (root: string, preset: string, kind: 'shipped' | 'denying' = 'shipped'): string =>
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
    ...safetyRow(preset, kind),
    '  - id: tier0',
    "    name: '@jozo-harness/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

const plugins = (
  llm: Plugin<{}, Llm, never>,
  safety: Plugin<any, any, any> = safetyPlugin,
): ReadonlyArray<Plugin<any, any, any>> => [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  safety,
  tier0Plugin,
  llm,
  agentPlugin,
  agentLoopPlugin,
]

const char = (value: string): KeyEvent => ({ kind: 'char', char: value })
const enter: KeyEvent = { kind: 'enter' }
const ctrlD: KeyEvent = { kind: 'ctrl', char: 'd' }
const typed = (text: string): ReadonlyArray<KeyEvent> => Array.from(text).map(char)

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
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-ws-'))
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

  test('a bash call runs in the terminal UI without a prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-ws-'))
    const tui = fakeTui(keyStream(spaced(typed('run')), spaced([enter]), later(ctrlD, 500)))

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
    const result = opened.events.find((event) => event.type === 'tool/result')

    expect(code).toBe(0)
    // A call the preset's mode covers is never a question: the sandbox is the boundary.
    expect(screen).not.toContain('[y/n]')
    expect(screen).toContain('all done')
    expect(asked).toBeUndefined()
    expect(result?.type === 'tool/result' ? result.data.isError : true).toBe(false)
    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  test('an escalation is asked from the keyboard and the approved retry runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-ws-'))
    const tui = fakeTui(
      keyStream(spaced(typed('run')), spaced([enter]), later(char('y'), 500), later(ctrlD, 1500)),
    )

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root, 'workspace-write', 'denying')],
        plugins: plugins(stubLlm([callBash, callBashWider, textTurn('all done')]), testSafety),
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
    const results = opened.events.flatMap((event) =>
      event.type === 'tool/result'
        ? [
            event.data as {
              readonly isError: boolean
              readonly content: ReadonlyArray<{ type: string; text?: string }>
            },
          ]
        : [],
    )
    const answered = opened.events.find((event) => event.type === 'safety/approval/answered')

    expect(code).toBe(0)
    // The denial is what the screen asks about; the answer comes from the keyboard.
    expect(screen).toContain('[y/n]')
    expect(screen).toContain('all done')
    expect(JSON.stringify(results[0]?.content)).toContain(
      '[sandbox: file access denied under workspace-write mode]',
    )
    expect(results[1]?.isError).toBe(false)
    expect(answered?.data.approved).toBe(true)
    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  test('resume draws the earlier conversation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-ws-'))
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

  test('page up reads back through what scrolled past', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-ws-'))
    const long = Array.from(
      { length: 40 },
      (_, index) => 'line-' + String(index + 1).padStart(2, '0'),
    ).join('\n')
    const pageUp: KeyEvent = { kind: 'pageUp' }
    const tui = fakeTui(
      keyStream(
        spaced(typed('hi')),
        spaced([enter]),
        later(pageUp, 400),
        spaced([pageUp, pageUp, pageUp, pageUp]),
        later(ctrlD, 600),
      ),
    )

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root, 'full')],
        plugins: plugins(stubLlm([textTurn(long)])),
        cwd: workspace,
        route: 'stub/model',
        tui: tui.io,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    // The run also writes the leave-screen bytes; only repaints are frames of the screen.
    const frames = tui.writes.filter((write) => write.startsWith('\u001b[H'))
    const tail = [...frames].reverse().find((frame) => frame.includes('line-40'))
    const last = frames[frames.length - 1] ?? ''
    expect(code).toBe(0)
    expect(tail).toBeDefined()
    expect(tail).not.toContain('line-01')
    expect(last).toContain('line-01')
    expect(last).not.toContain('line-40')
    expect(last).toContain('lines back')
    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  test('a wheel notch reads back through what scrolled past', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-ws-'))
    const long = Array.from(
      { length: 40 },
      (_, index) => 'line-' + String(index + 1).padStart(2, '0'),
    ).join('\n')
    const wheelUp: KeyEvent = { kind: 'wheelUp' }
    const tui = fakeTui(
      keyStream(
        spaced(typed('hi')),
        spaced([enter]),
        later(wheelUp, 400),
        spaced([wheelUp, wheelUp, wheelUp, wheelUp, wheelUp]),
        later(ctrlD, 600),
      ),
    )

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root, 'full')],
        plugins: plugins(stubLlm([textTurn(long)])),
        cwd: workspace,
        route: 'stub/model',
        tui: tui.io,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )

    const frames = tui.writes.filter((write) => write.startsWith('\u001b[H'))
    const last = frames[frames.length - 1] ?? ''
    expect(code).toBe(0)
    // Five notches are fifteen lines: the tail's last line has left the window.
    expect(last).not.toContain('line-40')
    expect(last).toContain('lines back')
    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  })
})
