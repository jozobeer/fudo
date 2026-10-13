import { describe, expect, test } from 'bun:test'
import type { UiCommand, UiEvent, UiHost } from '@fudo/ui-protocol'
import { Deferred, Effect, Queue, Stream } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serveWeb } from '../src/server/index.ts'
import { UiRpcs, withoutServices } from '../src/shared/rpc.ts'

interface FakeHost {
  readonly host: UiHost
  readonly commands: Array<UiCommand>
  readonly events: Queue.Queue<UiEvent, never>
}

const makeHost = (): FakeHost => {
  const commands: Array<UiCommand> = []
  const events = Effect.runSync(Queue.unbounded<UiEvent>())
  const record = (command: UiCommand): Effect.Effect<void> =>
    Effect.sync(() => {
      commands.push(command)
    })
  return {
    commands,
    events,
    host: {
      events: Stream.fromQueue(events),
      submit: (text) => record({ kind: 'submit', text }),
      approve: (callId, approved) => record({ kind: 'approve', callId, approved }),
      answer: (id, answer) => record({ kind: 'answer', id, answer }),
      cancel: () => record({ kind: 'cancel' }),
      answerApproval: () => Effect.succeed(true),
      answerAsk: () => Effect.succeed(''),
    },
  }
}

interface Observed {
  readonly accepted: boolean
  readonly received: UiEvent | undefined
  readonly home: string
  readonly homeStatus: number
  readonly missingStatus: number
  readonly traversalStatus: number
  readonly commands: ReadonlyArray<UiCommand>
}

describe('the web transport', () => {
  test('a browser client speaks commands and events over one socket', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-web-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'fudo-web-outside-'))
    await Bun.write(join(root, 'index.html'), '<h1>fudo</h1>')
    await Bun.write(join(outside, 'secret.txt'), 'secret')
    const fake = makeHost()

    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ready = yield* Deferred.make<string>()
          const stop = yield* Deferred.make<void>()
          yield* Effect.forkScoped(
            serveWeb({
              host: fake.host,
              port: 0,
              staticRoot: root,
              onReady: (url) => {
                void Effect.runSync(Deferred.succeed(ready, url))
              },
              interrupt: Deferred.await(stop),
            }),
          )
          const url = yield* Deferred.await(ready)
          const origin = url.replace(/\/$/, '')
          const wsUrl = 'ws://' + origin.replace(/^http:\/\//, '') + '/ui'

          // The client layers own a scoped socket: they must wrap every call.
          const useClient = Effect.gen(function* () {
            const client = yield* RpcClient.make(UiRpcs)
            const accepted = yield* client.command({ kind: 'submit', text: 'hello' })
            yield* Queue.offer(fake.events, {
              kind: 'session',
              event: { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
            })
            const collected = yield* client.events().pipe(Stream.take(1), Stream.runCollect)
            return { accepted, received: [...collected][0] }
          }).pipe(
            Effect.provide(RpcClient.layerProtocolSocket()),
            Effect.provide(Socket.layerWebSocket(wsUrl)),
            Effect.provide(Socket.layerWebSocketConstructorGlobal),
            Effect.provide(RpcSerialization.layerJson),
          )
          const { accepted, received } = yield* withoutServices(useClient)

          const home = yield* Effect.promise(() => fetch(origin + '/'))
          const missing = yield* Effect.promise(() => fetch(origin + '/nope.js'))
          const traversal = yield* Effect.promise(() => fetch(origin + '/%2e%2e/secret.txt'))
          const homeText = yield* Effect.promise(() => home.text())
          yield* Deferred.succeed(stop, undefined)

          return {
            accepted,
            received,
            home: homeText,
            homeStatus: home.status,
            missingStatus: missing.status,
            traversalStatus: traversal.status,
            commands: fake.commands,
          } satisfies Observed
        }),
      ),
    )

    expect(observed.accepted).toBe(true)
    expect(observed.commands).toEqual([{ kind: 'submit', text: 'hello' }])
    expect(observed.received?.kind).toBe('session')
    expect(observed.homeStatus).toBe(200)
    expect(observed.home).toContain('<h1>fudo</h1>')
    expect(observed.missingStatus).toBe(404)
    expect(observed.traversalStatus).toBe(404)
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
})
