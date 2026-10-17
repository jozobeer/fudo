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
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'
/** Writes a file, making the directories above it, the way Bun.write did. */
const writeFileDeep = async (path: string, text: string | Uint8Array): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

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
            const path =
              /the full result is stored at (.+?); use the read tool/.exec(text)?.[1] ?? 'missing'
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

describe('a search whose result is too big for one message', () => {
  test('the whole result lands in the spill file and the model reads past the preview', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-search-'))
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-ws-'))
    const home = await mkdtemp(join(tmpdir(), 'jozo-harness-home-'))
    const lines: Array<string> = []
    for (let index = 0; index < MATCHES; index += 1) {
      lines.push('needle-' + String(index) + ' ' + 'p'.repeat(40))
    }
    await writeFileDeep(join(workspace, 'many.txt'), lines.join('\n') + '\n')
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
        jzhHome: home,
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
    const spillPath =
      /the full result is stored at (.+?); use the read tool/.exec(notice)?.[1] ?? ''

    // The page is not the whole story; the file is.
    expect(notice).toContain('showing 250 of 2000 matches')
    expect(spillPath.length).toBeGreaterThan(0)
    const body = await readFile(spillPath, 'utf8')
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
