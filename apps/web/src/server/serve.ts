import { fileURLToPath } from 'node:url'
import { Effect, Layer, Stream } from 'effect'
import { RpcSerialization, RpcServer } from 'effect/rpc'
import { sendCommand } from '@jozo-harness/ui-protocol'
import { UiRpcs } from '../shared/rpc.ts'
import { makeWebProtocol, type Connection } from './protocol.ts'
import {
  makeSessionRegistry,
  type OpenSession,
  type SessionFactory,
  type SessionRegistry,
} from './sessions.ts'
import type { SettingsPort } from './settings.ts'
import { staticResponse } from './static.ts'

export const UI_PATH = '/ui'

/** Where the built browser app sits when no other root is given. */
export const defaultStaticRoot = fileURLToPath(new URL('../../dist/', import.meta.url))

export interface ServeWebOptions {
  /** The session a page opens when it names none. */
  readonly initial: OpenSession
  /** Opens the rest: a page may ask for any session the store holds. */
  readonly factory: SessionFactory
  /** What the page may read and change about the run behind it. */
  readonly settings: SettingsPort
  /** 0 picks a free port; the chosen one arrives through `onReady`. */
  readonly port: number
  readonly staticRoot: string
  readonly onReady: (url: string) => void
  /** Completes to stop the server, as SIGINT does. */
  readonly interrupt?: Effect.Effect<void>
}

const handlersOf = (registry: SessionRegistry, settings: SettingsPort) =>
  UiRpcs.toLayer({
    sessions: () =>
      registry.list().pipe(
        Effect.map((items) => ({ initial: registry.initial, items })),
        Effect.mapError((error) => error.message),
      ),
    open: ({ sessionId }) =>
      registry.open(sessionId).pipe(
        Effect.map((session) => session.summary),
        Effect.mapError((error) => error.message),
      ),
    command: ({ sessionId, command }) => {
      const host = registry.hostOf(sessionId)
      return host === undefined
        ? Effect.succeed(false)
        : sendCommand(host, command).pipe(
            Effect.as(true),
            Effect.catchCause(() => Effect.succeed(false)),
          )
    },
    events: ({ sessionId }) => {
      const host = registry.hostOf(sessionId)
      return host === undefined ? Stream.fail('the session is not open') : host.events
    },
    state: ({ sessionId }) => {
      const view = registry.stateOf(sessionId)
      return view === undefined ? Effect.fail('the session is not open') : Effect.succeed(view)
    },
    jobDetail: ({ sessionId, id }) => {
      const session = registry.sessionOf(sessionId)
      return session === undefined
        ? Effect.fail('the session is not open')
        : session.jobOutput(id).pipe(Effect.mapError((error) => error.message))
    },
    stopJob: ({ sessionId, id }) => {
      const session = registry.sessionOf(sessionId)
      return session === undefined
        ? Effect.fail('the session is not open')
        : session.stopJob(id).pipe(
            Effect.as(true),
            Effect.mapError((error) => error.message),
          )
    },
    settings: () => settings.read().pipe(Effect.mapError((error) => error.message)),
    models: () => settings.models().pipe(Effect.mapError((error) => error.message)),
    setModel: ({ model }) =>
      settings.setModel(model).pipe(
        Effect.as(true),
        Effect.mapError((error) => error.message),
      ),
  })

const serveStatic = async (root: string, requestPath: string): Promise<Response> =>
  (await staticResponse(root, requestPath)) ?? new Response('not found', { status: 404 })

/**
 * Serves the sessions of one profile: the browser app, the RPC socket, and
 * nothing else. Binds to loopback only; there is no authentication.
 */
export const serveWeb = (options: ServeWebOptions): Effect.Effect<number> =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = yield* makeSessionRegistry({
        initial: options.initial,
        factory: options.factory,
      })
      const { protocol, attach } = yield* makeWebProtocol
      const connections = new Map<unknown, Connection>()

      const server = Bun.serve({
        port: options.port,
        hostname: '127.0.0.1',
        fetch: (request, self) => {
          const path = new URL(request.url).pathname
          if (path === UI_PATH) {
            return self.upgrade(request)
              ? undefined
              : new Response('websocket required', { status: 426 })
          }
          return serveStatic(options.staticRoot, path)
        },
        websocket: {
          open: (ws) => {
            connections.set(
              ws,
              attach((text) => ws.send(text)),
            )
          },
          message: (ws, data) => {
            connections.get(ws)?.message(data)
          },
          close: (ws) => {
            connections.get(ws)?.close()
            connections.delete(ws)
          },
        },
      })

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          server.stop(true)
        }),
      )
      // Our schemas need no decoding services, but Effect types a stream RPC's
      // service requirement as `unknown`; the layer is pinned to what it is.
      const rpc: Layer.Layer<never> = RpcServer.layer(UiRpcs).pipe(
        Layer.provide(handlersOf(registry, options.settings)),
        Layer.provide(Layer.succeed(RpcServer.Protocol, protocol)),
      ) as unknown as Layer.Layer<never>
      yield* Effect.forkScoped(Layer.launch(rpc))
      options.onReady('http://127.0.0.1:' + String(server.port) + '/')
      return options.interrupt === undefined
        ? yield* Effect.never
        : yield* options.interrupt.pipe(Effect.as(130))
    }),
  ).pipe(Effect.provide(RpcSerialization.layerJson))
