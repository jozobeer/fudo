import { expect, test } from 'bun:test'
import { Effect } from 'effect'

test('Effect runs under bun test', async () => {
  const value = await Effect.runPromise(Effect.succeed(1).pipe(Effect.map((n) => n + 1)))
  expect(value).toBe(2)
})
