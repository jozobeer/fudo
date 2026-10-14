import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { tier0Plugin } from '@fudo/tools-tier0'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const MATCHES = 2000

const callTool = (name: string, args: unknown): ReadonlyArray<StreamChunk> => [
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

const seenText = (request: {
  readonly messages: ReadonlyArray<{
    readonly content: ReadonlyArray<{ type: string; text?: string }>
  }>
}): string =>
  request.messages
    .flatMap((message) => message.content)
    .flatMap((block) => (block.type === 'text' ? [block.text ?? ''] : []))
    .join('\n')

/** Answers like a model that reads past the preview of a spilled search result. */
const stubLlm = (seen: Array<string>): Plugin<{}, Llm, never> => {
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
          const text = seenText(request)
          seen.push(text)
          call += 1
          if (call === 1) return Stream.fromIterable(callTool('grep', { pattern: 'needle' }))
          if (call === 2) {
            const path = /\[spilled to (.+?): \d+ lines/.exec(text)?.[1] ?? 'missing'
            return Stream.fromIterable(callTool('read', { path, offset: 1995, limit: 10 }))
          }
          return Stream.fromIterable(textTurn('done'))
        },
      } satisfies LlmAdapter),
  }
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
    '  - id: tier0',
    "    name: '@fudo/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('a search whose result is too big for one message', () => {
  test('the whole result lands in the spill file and the model reads past the preview', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-search-'))
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-ws-'))
    const home = await mkdtemp(join(tmpdir(), 'fudo-home-'))
    const lines: Array<string> = []
    for (let index = 0; index < MATCHES; index += 1) {
      lines.push('needle-' + String(index) + ' ' + 'p'.repeat(40))
    }
    await Bun.write(join(workspace, 'many.txt'), lines.join('\n') + '\n')
    const seen: Array<string> = []

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
          tier0Plugin,
          stubLlm(seen),
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: workspace,
        route: 'stub/model',
        task: 'find every needle',
        fudoHome: home,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    const listed = await Effect.runPromise(jsonlSessions({ root }).list())
    const id = listed[0]?.id ?? ''
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(id))
    const first = opened.events.find((event) => event.type === 'tool/result')
    const notice = JSON.stringify(first?.type === 'tool/result' ? first.data.content : [])
    const spillPath = /\[spilled to (.+?): \d+ lines/.exec(notice)?.[1] ?? ''

    // The preview is not the whole story; the file is.
    expect(notice).toContain('[spilled to ')
    expect(spillPath.length).toBeGreaterThan(0)
    const body = await Bun.file(spillPath).text()
    expect(body).toContain('needle-0 ')
    expect(body).toContain('needle-' + String(MATCHES - 1))
    // The session's spill directory is what keeps other users out of the file.
    expect((await stat(dirname(spillPath))).mode & 0o777 & 0o077).toBe(0)

    // The model went back for the tail of the search it could not see.
    expect(seen[2]).toContain('needle-' + String(MATCHES - 1))

    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  })
})
