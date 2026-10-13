import { fileURLToPath } from 'node:url'
import { Effect, Layer } from 'effect'
import { RpcSerialization, RpcServer } from 'effect/rpc'
import { sendCommand, type UiHost } from '@fudo/ui-protocol'
import { UiRpcs } from '../shared/rpc.ts'
import { makeWebProtocol, type Connection } from './protocol.ts'
import { staticResponse } from './static.ts'

export const UI_PATH = '/ui'

/** Where the built browser app sits when no other root is given. */
export const defaultStaticRoot = fileURLToPath(new URL('../../dist/', import.meta.url))

export interface ServeWebOptions {
  readonly host: UiHost
  /** 0 picks a free port; the chosen one arrives through `onReady`. */
  readonly port: number
  readonly staticRoot: string
  readonly onReady: (url: string) => void
  /** Completes to stop the server, as SIGINT does. */
  readonly interrupt?: Effect.Effect<void>
}

const handlersOf = (host: UiHost) =>
  UiRpcs.toLayer({
    command: (command) =>
      sendCommand(host, command).pipe(
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      ),
    events: () => host.events,
  })

const serveStatic = async (root: string, requestPath: string): Promise<Response> =>
  (await staticResponse(root, requestPath)) ?? new Response('not found', { status: 404 })

/**
 * Serves one running core: the browser app, the RPC socket, and nothing else.
 * Binds to loopback only; there is no authentication.
 */
export const serveWeb = (options: ServeWebOptions): Effect.Effect<number> =>
  Effect.scoped(
    Effect.gen(function* () {
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
        Layer.provide(handlersOf(options.host)),
        Layer.provide(Layer.succeed(RpcServer.Protocol, protocol)),
      ) as unknown as Layer.Layer<never>
      yield* Effect.forkScoped(Layer.launch(rpc))
      options.onReady('http://127.0.0.1:' + String(server.port) + '/')
      return options.interrupt === undefined
        ? yield* Effect.never
        : yield* options.interrupt.pipe(Effect.as(130))
    }),
  ).pipe(Effect.provide(RpcSerialization.layerJson))
