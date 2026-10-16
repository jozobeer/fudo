import { describe, expect, test } from 'bun:test'
import type { UiCommand, UiEvent, UiHost } from '@jozo-harness/ui-protocol'
import { Deferred, Effect, Exit, Fiber, Option, Queue, Stream, type Scope } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serveWeb, type OpenSession, type SessionFactory } from '../src/server/index.ts'
import { type SessionSummary, UiRpcs, withoutServices } from '../src/shared/rpc.ts'

interface FakeHost {
  readonly summary: SessionSummary
  readonly host: UiHost
  readonly commands: Array<UiCommand>
  /** Broadcasts one event to every tab, like the real host does. */
  readonly publish: (event: UiEvent) => void
}

const makeHost = (id: string): FakeHost => {
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
    summary: { id, cwd: '/work', createdAt: 1 },
    commands,
    publish,
    host: {
      events,
      submit: (text) => record({ kind: 'submit', text }),
      approve: (callId, approved) => record({ kind: 'approve', callId, approved }),
      answer: (id2, answer) => record({ kind: 'answer', id: id2, answer }),
      cancel: () => record({ kind: 'cancel' }),
      answerApproval: () => Effect.succeed(true),
      answerAsk: () => Effect.succeed(''),
    },
  }
}

interface FakeWeb {
  readonly initial: OpenSession
  readonly factory: SessionFactory
  readonly hosts: Map<string, FakeHost>
}

/** The sessions one fake store holds: the boot one, plus whatever a page opens. */
const makeWeb = (initialId: string): FakeWeb => {
  const first = makeHost(initialId)
  const hosts = new Map<string, FakeHost>([[initialId, first]])
  return {
    hosts,
    initial: { summary: first.summary, host: first.host },
    factory: {
      list: () => Effect.succeed([...hosts.values()].map((fake) => fake.summary)),
      open: (id) =>
        Effect.sync(() => {
          const made = id ?? 'new-' + String(hosts.size + 1)
          const known = hosts.get(made)
          if (known !== undefined) return { summary: known.summary, host: known.host }
          const fresh = makeHost(made)
          hosts.set(made, fresh)
          return { summary: fresh.summary, host: fresh.host }
        }),
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

const start = (staticRoot: string, web: FakeWeb): Effect.Effect<Started, never, Scope.Scope> =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<string>()
    const stop = yield* Deferred.make<void>()
    yield* Effect.forkScoped(
      serveWeb({
        initial: web.initial,
        factory: web.factory,
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

const tick = (): UiEvent => ({
  kind: 'session',
  event: { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
})

describe('the web transport', () => {
  test('a browser client speaks commands and events over one socket', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-web-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'jozo-harness-web-outside-'))
    await Bun.write(join(root, 'index.html'), '<h1>jozo-harness</h1>')
    await Bun.write(join(outside, 'secret.txt'), 'secret')
    const web = makeWeb('a')

    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* start(root, web)
          const wsUrl = 'ws://' + started.origin.replace(/^http:\/\//, '') + '/ui'

          // The client layers own a scoped socket: they must wrap every call.
          const useClient = Effect.gen(function* () {
            const client = yield* RpcClient.make(UiRpcs)
            const accepted = yield* client.command({
              sessionId: 'a',
              command: { kind: 'submit', text: 'hello' },
            })
            const collected = yield* Effect.forkScoped(
              client.events({ sessionId: 'a' }).pipe(Stream.take(1), Stream.runCollect),
            )
            yield* Effect.sleep(50)
            web.hosts.get('a')?.publish(tick())
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
            commands: web.hosts.get('a')?.commands ?? [],
          }
        }),
      ),
    )

    expect(observed.accepted).toBe(true)
    expect(observed.commands).toEqual([{ kind: 'submit', text: 'hello' }])
    expect(observed.received?.kind).toBe('session')
    expect(observed.homeStatus).toBe(200)
    expect(observed.home).toContain('<h1>jozo-harness</h1>')
    expect(observed.missingStatus).toBe(404)
    expect(observed.traversalStatus).toBe(404)
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  test('two tabs subscribe to the same conversation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-web-tabs-'))
    await Bun.write(join(root, 'index.html'), '<h1>jozo-harness</h1>')
    const web = makeWeb('a')

    const counts = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* start(root, web)
          const wsUrl = 'ws://' + started.origin.replace(/^http:\/\//, '') + '/ui'
          const useTabs = Effect.gen(function* () {
            const one = yield* RpcClient.make(UiRpcs)
            const two = yield* RpcClient.make(UiRpcs)
            const first = yield* Effect.forkScoped(
              one.events({ sessionId: 'a' }).pipe(Stream.take(1), Stream.runCollect),
            )
            const second = yield* Effect.forkScoped(
              two.events({ sessionId: 'a' }).pipe(Stream.take(1), Stream.runCollect),
            )
            yield* Effect.sleep(50)
            web.hosts.get('a')?.publish(tick())
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

  test('the page lists the store, opens one more, and each id keeps its own conversation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-web-sessions-'))
    await Bun.write(join(root, 'index.html'), '<h1>jozo-harness</h1>')
    const web = makeWeb('a')

    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* start(root, web)
          const wsUrl = 'ws://' + started.origin.replace(/^http:\/\//, '') + '/ui'
          const useClient = Effect.gen(function* () {
            const client = yield* RpcClient.make(UiRpcs)
            const listed = yield* client.sessions()
            const again = yield* client.open({ sessionId: 'a' })
            const made = yield* client.open({})
            const accepted = yield* client.command({
              sessionId: made.id,
              command: { kind: 'cancel' },
            })
            // A listener on 'a' that never hears the new session's event runs out of time.
            const watching = yield* Effect.forkScoped(
              client
                .events({ sessionId: 'a' })
                .pipe(Stream.take(1), Stream.runCollect, Effect.timeoutOption('200 millis')),
            )
            const unknown = yield* client
              .events({ sessionId: 'gone' })
              .pipe(Stream.take(1), Stream.runCollect, Effect.exit)
            yield* Effect.sleep(50)
            web.hosts.get(made.id)?.publish(tick())
            const heard = yield* Fiber.join(watching)
            return {
              listed,
              again: again.id,
              made: made.id,
              accepted,
              silent: Option.isNone(heard),
              refused: Exit.isFailure(unknown),
              onNew: web.hosts.get(made.id)?.commands ?? [],
            }
          }).pipe(clientLayers(wsUrl))
          const result = yield* withoutServices(useClient)
          yield* Deferred.succeed(started.stop, undefined)
          return result
        }),
      ),
    )

    expect(observed.listed).toEqual({
      initial: 'a',
      items: [{ id: 'a', cwd: '/work', createdAt: 1 }],
    })
    expect(observed.again).toBe('a')
    expect(observed.made).toBe('new-2')
    expect(observed.accepted).toBe(true)
    expect(observed.onNew).toEqual([{ kind: 'cancel' }])
    expect(observed.silent).toBe(true)
    expect(observed.refused).toBe(true)
    await rm(root, { recursive: true, force: true })
  })
})
