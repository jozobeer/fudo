import { beforeAll, describe, expect, test } from 'bun:test'
import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { sessionPlugin, type AssistantMessageData } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { Deferred, Effect, Layer, Schema, Stream } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCommand } from '../src/index.ts'
import { UiRpcs, withoutServices } from '@fudo/web'

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
  layer: () =>
    Layer.succeed(Llm, {
      name: 'stub',
      capabilities: {
        toolChoice: false,
        reasoningEffort: null,
        images: 'none',
        promptCacheControl: false,
      },
      stream: () => Stream.fromIterable(textTurn('hello from fudo')),
    } satisfies LlmAdapter),
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
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

const plugins: ReadonlyArray<Plugin<any, any, any>> = [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  stubLlm,
  agentPlugin,
  agentLoopPlugin,
]

const textOf = (data: AssistantMessageData): string =>
  data.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')

describe('the browser UI through the command', () => {
  beforeAll(async () => {
    // The served files are build output; this test builds them itself.
    const build = Bun.spawn([process.execPath, 'run', 'build'], {
      cwd: join(import.meta.dir, '../../web'),
      stdout: 'ignore',
      stderr: 'inherit',
    })
    expect(await build.exited).toBe(0)
  }, 60_000)

  test('a browser client drives a real turn and the static app is served', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-web-'))
    const workspace = await mkdtemp(join(tmpdir(), 'fudo-web-ws-'))
    const ready = await Effect.runSync(Deferred.make<string>())
    const stop = await Effect.runSync(Deferred.make<void>())

    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.forkScoped(
            runCommand({
              profiles: [profile(root)],
              plugins,
              cwd: workspace,
              route: 'stub/model',
              web: { port: 0 },
              stdout: () => undefined,
              stderr: (text) => {
                const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)
                if (match !== null) void Effect.runSync(Deferred.succeed(ready, match[0]))
              },
              interrupt: Deferred.await(stop),
            }),
          )
          const url = (yield* Deferred.await(ready)).replace(/\/$/, '')
          const wsUrl = 'ws://' + url.replace(/^http:\/\//, '') + '/ui'

          const used = Effect.gen(function* () {
            const client = yield* RpcClient.make(UiRpcs)
            const seen = yield* Deferred.make<string>()
            yield* Effect.forkScoped(
              client.events().pipe(
                Stream.runForEach((event) =>
                  Effect.gen(function* () {
                    if (event.kind !== 'session' || event.event.type !== 'assistant/message') return
                    yield* Deferred.succeed(seen, textOf(event.event.data as AssistantMessageData))
                  }),
                ),
              ),
            )
            const accepted = yield* client.command({ kind: 'submit', text: 'ping' })
            const answer = yield* Deferred.await(seen)
            const page = yield* Effect.promise(() => fetch(url + '/'))
            const home = yield* Effect.promise(() => page.text())
            return { accepted, answer, status: page.status, home }
          })

          const result = yield* withoutServices(used).pipe(
            Effect.provide(RpcClient.layerProtocolSocket()),
            Effect.provide(Socket.layerWebSocket(wsUrl)),
            Effect.provide(Socket.layerWebSocketConstructorGlobal),
            Effect.provide(RpcSerialization.layerJson),
          )
          yield* Deferred.succeed(stop, undefined)
          return result
        }),
      ),
    )

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))

    expect(observed.accepted).toBe(true)
    expect(observed.answer).toContain('hello from fudo')
    expect(observed.status).toBe(200)
    expect(observed.home).toContain('<title>fudo</title>')
    expect(
      opened.events.flatMap((event) =>
        event.type === 'user/message' && event.data.source === 'user' ? [event.data.text] : [],
      ),
    ).toEqual(['ping'])
    await rm(root, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  }, 20_000)
})
