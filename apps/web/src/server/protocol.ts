import { Effect, Queue } from 'effect'
import { RpcMessage, RpcSerialization, RpcServer } from 'effect/rpc'

/** One accepted WebSocket: the transport pushes frames in and sends frames out. */
export interface Connection {
  readonly message: (data: Uint8Array | string) => void
  readonly close: () => void
}

export interface WebProtocol {
  readonly protocol: RpcServer.Protocol['Service']
  /** Attaches one connection; `send` writes an encoded frame to the wire. */
  readonly attach: (send: (text: string) => void) => Connection
}

const decodeText = (encoded: Uint8Array | string): string =>
  typeof encoded === 'string' ? encoded : new TextDecoder().decode(encoded)

/**
 * The RPC server protocol over one framed message per WebSocket frame. This is
 * the only place fudo uses `effect/rpc`; a change in its framing stays here.
 */
export const makeWebProtocol: Effect.Effect<WebProtocol, never, RpcSerialization.RpcSerialization> =
  Effect.gen(function* () {
    const serialization = yield* RpcSerialization.RpcSerialization
    const disconnects = yield* Queue.unbounded<number>()
    const clients = new Map<number, (response: RpcMessage.FromServerEncoded) => void>()
    const clientIds = new Set<number>()
    let nextId = 0
    let dispatch: (
      clientId: number,
      message: RpcMessage.FromClientEncoded,
    ) => Effect.Effect<void> = () => Effect.void

    const protocol = yield* RpcServer.Protocol.make((writeRequest) => {
      dispatch = writeRequest
      return Effect.succeed({
        disconnects,
        send: (clientId, response) =>
          Effect.sync(() => {
            clients.get(clientId)?.(response)
          }),
        end: (clientId) =>
          Effect.sync(() => {
            clients.delete(clientId)
            clientIds.delete(clientId)
          }),
        clientIds: Effect.sync(() => clientIds),
        initialMessage: Effect.succeedNone,
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
        supportsNotifications: true,
        codecFor: serialization.codecFor,
      })
    })

    const attach = (send: (text: string) => void): Connection => {
      const id = nextId
      nextId += 1
      const parser = serialization.makeUnsafe()
      clients.set(id, (response) => {
        const encoded = parser.encode(response)
        if (encoded !== undefined) send(decodeText(encoded))
      })
      clientIds.add(id)
      return {
        message: (data) => {
          for (const message of parser.decode(data)) {
            void Effect.runFork(dispatch(id, message as RpcMessage.FromClientEncoded))
          }
        },
        close: () => {
          clients.delete(id)
          clientIds.delete(id)
          void Effect.runFork(Queue.offer(disconnects, id))
        },
      }
    }

    return { protocol, attach }
  })
