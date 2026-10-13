import { Effect, type Scope } from 'effect'
import { ToolError } from '@fudo/tools'
import { decodeResponse, encodeRequest, type McpResponse } from './mcp-codec.ts'

export interface McpServerOptions {
  readonly command: ReadonlyArray<string>
  readonly cwd?: string
}

export interface McpClientShape {
  /** Sends one request and waits for the response with the same id. */
  readonly request: (method: string, params?: unknown) => Effect.Effect<unknown, ToolError>
  /** Ends the server process. */
  readonly close: () => Effect.Effect<void>
}

/**
 * Starts one MCP server over stdio and talks JSON-RPC to it, one request at a
 * time. v1 only needs the handshake, the tool list, and tool calls.
 */
export const startMcpServer = (
  options: McpServerOptions,
): Effect.Effect<McpClientShape, ToolError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const server = Bun.spawn({
        cmd: [...options.command],
        cwd: options.cwd ?? process.cwd(),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'ignore',
      })
      const pending = new Map<number, (response: McpResponse) => void>()
      let counter = 0
      const decoder = new TextDecoder()
      let buffer = ''

      void (async () => {
        const reader = server.stdout.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value === undefined) continue
          buffer += decoder.decode(value)
          let index = buffer.indexOf('\n')
          while (index >= 0) {
            const line = buffer.slice(0, index)
            buffer = buffer.slice(index + 1)
            const response = decodeResponse(line)
            if (response !== undefined) {
              const resolve = pending.get(response.id)
              if (resolve !== undefined) {
                pending.delete(response.id)
                resolve(response)
              }
            }
            index = buffer.indexOf('\n')
          }
        }
      })()

      return {
        request: (method, params) =>
          Effect.promise(
            () =>
              new Promise<unknown>((resolve, reject) => {
                counter += 1
                const id = counter
                pending.set(id, (response) => {
                  if (response.error !== undefined) reject(new Error(response.error.message))
                  else resolve(response.result)
                })
                server.stdin.write(encodeRequest(id, method, params))
                server.stdin.flush()
              }),
          ).pipe(
            Effect.mapError(
              () => new ToolError({ code: 'execution', message: 'mcp call failed: ' + method }),
            ),
          ),
        close: () =>
          Effect.sync(() => {
            server.kill()
          }),
      }
    }),
    (client) => client.close(),
  )
