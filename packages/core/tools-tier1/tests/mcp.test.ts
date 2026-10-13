import { Effect } from 'effect'
import { describe, expect, test } from 'bun:test'
import { startMcpServer, TOOLS_LIST } from '../src/index.ts'

const echoServer = [
  'bash',
  '-lc',
  'while IFS= read -r line; do id=$(printf "%s" "$line" | sed -n \'s/.*"id":\\([0-9]*\\).*/\\1/p\'); printf \'{"jsonrpc":"2.0","id":%s,"result":{"method":"seen","ok":true}}\\n\' "$id"; done',
]

describe('startMcpServer', () => {
  test('round-trips a request over stdio', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* startMcpServer({ command: echoServer })
          const first = yield* client.request(TOOLS_LIST)
          const second = yield* client.request('tools/call', { name: 'echo', arguments: {} })
          yield* client.close()
          return { first, second }
        }),
      ),
    )

    expect(observed.first).toEqual({ method: 'seen', ok: true })
    expect(observed.second).toEqual({ method: 'seen', ok: true })
  })

  test('a server that is not there reports a tool error', async () => {
    const message = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* startMcpServer({ command: ['bash', '-lc', 'exit 0'] })
        return yield* Effect.match(client.request(TOOLS_LIST), {
          onFailure: (error) => error.message,
          onSuccess: () => 'answered',
        })
      }).pipe(
        Effect.timeout('2 seconds'),
        Effect.orElseSucceed(() => 'timed out'),
      ),
    )

    expect(message === 'timed out' || message.includes('mcp call failed')).toBe(true)
  })
})
