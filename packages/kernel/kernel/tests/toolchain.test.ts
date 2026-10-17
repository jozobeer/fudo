import { expect, test } from 'vitest'
import { Effect } from 'effect'

test('Effect runs under the test runner', async () => {
  const value = await Effect.runPromise(Effect.succeed(1).pipe(Effect.map((n) => n + 1)))
  expect(value).toBe(2)
})
