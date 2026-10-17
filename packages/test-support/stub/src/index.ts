import { createServer, type IncomingMessage } from 'node:http'

/** A loopback HTTP server a test can point a client at. */
export interface StubServer {
  /** Where the stub listens, without a trailing slash. */
  readonly origin: string
  /** Stops the server and drops whatever connection is still open. */
  readonly stop: () => Promise<void>
}

/** The body a node request carried, or undefined when it carried none. */
const bodyOf = async (request: IncomingMessage): Promise<Buffer | undefined> => {
  const method = request.method ?? 'GET'
  if (method === 'GET' || method === 'HEAD') return undefined
  const chunks: Array<Buffer> = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return chunks.length === 0 ? undefined : Buffer.concat(chunks)
}

/** The headers a node request carried, in the web shape. */
const headersOf = (raw: IncomingMessage['headers']): Headers => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string') headers.set(name, value)
    else if (Array.isArray(value)) for (const item of value) headers.append(name, item)
  }
  return headers
}

/** The web request a node request carries, so a handler reads it the way it reads a server's. */
const requestOf = async (request: IncomingMessage): Promise<Request> => {
  const body = await bodyOf(request)
  return new Request('http://127.0.0.1' + (request.url ?? '/'), {
    method: request.method ?? 'GET',
    headers: headersOf(request.headers),
    ...(body === undefined ? {} : { body }),
  })
}

/**
 * Starts a one-connection-at-a-time stub on a free loopback port. The handler
 * takes a web `Request` and returns a `Response`, the shape Bun.serve took.
 */
export const startStubServer = async (
  handle: (request: Request) => Response | Promise<Response>,
): Promise<StubServer> => {
  const server = createServer((request, response) => {
    void Promise.resolve()
      .then(() => requestOf(request))
      .then((web) => handle(web))
      .then(
        async (answer) => {
          response.writeHead(answer.status, Object.fromEntries(answer.headers))
          response.end(Buffer.from(await answer.arrayBuffer()))
        },
        () => {
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('the stub handler failed')
        },
      )
  })
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
  return {
    origin: 'http://127.0.0.1:' + String(port),
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
