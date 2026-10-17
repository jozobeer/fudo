import { Effect, type Scope } from 'effect'
import { ToolError } from '@jozo-harness/tools'
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

/** Splits decoded text into lines, holding the tail that has no newline yet. */
const takeLines = (buffered: string, decoded: string): { lines: Array<string>; rest: string } => {
  const lines: Array<string> = []
  let rest = buffered + decoded
  let index = rest.indexOf('\n')
  while (index >= 0) {
    lines.push(rest.slice(0, index))
    rest = rest.slice(index + 1)
    index = rest.indexOf('\n')
  }
  return { lines, rest }
}

/** Reads a byte stream as newline-delimited text until it ends. */
const readLines = async (
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let rest = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    if (value === undefined) continue
    const taken = takeLines(rest, decoder.decode(value))
    rest = taken.rest
    for (const line of taken.lines) onLine(line)
  }
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

      void readLines(server.stdout, (line) => {
        const response = decodeResponse(line)
        if (response === undefined) return
        const resolve = pending.get(response.id)
        if (resolve === undefined) return
        pending.delete(response.id)
        resolve(response)
      })

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
                void server.stdin.write(encodeRequest(id, method, params))
                void server.stdin.flush()
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
