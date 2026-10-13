import { describe, expect, test } from 'bun:test'
import type { UiCommand, UiEvent, UiHost } from '@fudo/ui-protocol'
import { Deferred, Effect, Fiber, Queue, Stream, type Scope } from 'effect'
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
  /** Broadcasts one event to every tab, like the real host does. */
  readonly publish: (event: UiEvent) => void
}

const makeHost = (): FakeHost => {
  const commands: Array<UiCommand> = []
  const subscribers = new Set<Queue.Queue<UiEvent>>()
  const publish = (event: UiEvent): void => {
    for (const queue of subscribers.values().toArray()) Queue.offerUnsafe(queue, event)
  }
  const events = Stream.scoped(
    Stream.unwrap(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<UiEvent>()
        subscribers.add(queue)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            subscribers.delete(queue)
          }),
        )
        return Stream.fromQueue(queue)
      }),
    ),
  )
  const record = (command: UiCommand): Effect.Effect<void> =>
    Effect.sync(() => {
      commands.push(command)
    })
  return {
    commands,
    publish,
    host: {
      events,
      submit: (text) => record({ kind: 'submit', text }),
      approve: (callId, approved) => record({ kind: 'approve', callId, approved }),
      answer: (id, answer) => record({ kind: 'answer', id, answer }),
      cancel: () => record({ kind: 'cancel' }),
      answerApproval: () => Effect.succeed(true),
      answerAsk: () => Effect.succeed(''),
    },
  }
}

const clientLayers =
  (wsUrl: string) =>
  <A, E>(self: Effect.Effect<A, E, unknown>): Effect.Effect<A, E> =>
    self.pipe(
      Effect.provide(RpcClient.layerProtocolSocket()),
      Effect.provide(Socket.layerWebSocket(wsUrl)),
      Effect.provide(Socket.layerWebSocketConstructorGlobal),
      Effect.provide(RpcSerialization.layerJson),
    ) as Effect.Effect<A, E>

interface Started {
  readonly origin: string
  readonly stop: Deferred.Deferred<void>
}

const start = (staticRoot: string, host: UiHost): Effect.Effect<Started, never, Scope.Scope> =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<string>()
    const stop = yield* Deferred.make<void>()
    yield* Effect.forkScoped(
      serveWeb({
        host,
        port: 0,
        staticRoot,
        onReady: (url) => {
          void Effect.runSync(Deferred.succeed(ready, url))
        },
        interrupt: Deferred.await(stop),
      }),
    )
    return { origin: (yield* Deferred.await(ready)).replace(/\/$/, ''), stop }
  })

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
          const started = yield* start(root, fake.host)
          const wsUrl = 'ws://' + started.origin.replace(/^http:\/\//, '') + '/ui'

          // The client layers own a scoped socket: they must wrap every call.
          const useClient = Effect.gen(function* () {
            const client = yield* RpcClient.make(UiRpcs)
            const accepted = yield* client.command({ kind: 'submit', text: 'hello' })
            const collected = yield* Effect.forkScoped(
              client.events().pipe(Stream.take(1), Stream.runCollect),
            )
            yield* Effect.sleep(50)
            fake.publish({
              kind: 'session',
              event: { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
            })
            return { accepted, received: [...(yield* Fiber.join(collected))][0] }
          }).pipe(clientLayers(wsUrl))
          const { accepted, received } = yield* withoutServices(useClient)

          const home = yield* Effect.promise(() => fetch(started.origin + '/'))
          const missing = yield* Effect.promise(() => fetch(started.origin + '/nope.js'))
          const traversal = yield* Effect.promise(() =>
            fetch(started.origin + '/%2e%2e/secret.txt'),
          )
          const homeText = yield* Effect.promise(() => home.text())
          yield* Deferred.succeed(started.stop, undefined)

          return {
            accepted,
            received,
            home: homeText,
            homeStatus: home.status,
            missingStatus: missing.status,
            traversalStatus: traversal.status,
            commands: fake.commands,
          }
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

  test('two tabs subscribe to the same conversation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-web-tabs-'))
    await Bun.write(join(root, 'index.html'), '<h1>fudo</h1>')
    const fake = makeHost()

    const counts = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* start(root, fake.host)
          const wsUrl = 'ws://' + started.origin.replace(/^http:\/\//, '') + '/ui'
          const useTabs = Effect.gen(function* () {
            const one = yield* RpcClient.make(UiRpcs)
            const two = yield* RpcClient.make(UiRpcs)
            const first = yield* Effect.forkScoped(
              one.events().pipe(Stream.take(1), Stream.runCollect),
            )
            const second = yield* Effect.forkScoped(
              two.events().pipe(Stream.take(1), Stream.runCollect),
            )
            yield* Effect.sleep(50)
            fake.publish({
              kind: 'session',
              event: { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
            })
            return {
              first: [...(yield* Fiber.join(first))].length,
              second: [...(yield* Fiber.join(second))].length,
            }
          }).pipe(clientLayers(wsUrl))
          const result = yield* withoutServices(useTabs)
          yield* Deferred.succeed(started.stop, undefined)
          return result
        }),
      ),
    )

    expect(counts).toEqual({ first: 1, second: 1 })
    await rm(root, { recursive: true, force: true })
  })
})
