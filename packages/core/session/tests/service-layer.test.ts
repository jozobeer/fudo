import { describe, expect, test } from 'bun:test'
import { HooksLive } from '@fudo/kernel'
import { Effect, Layer } from 'effect'
import { Sessions, SessionPersistenceService, sessionsFromServiceLayer } from '../src/index.ts'
import { makeFakePersistence } from './support.ts'

describe('sessionsFromServiceLayer', () => {
  test('resolves the persistence provider from the context', async () => {
    const persistence = makeFakePersistence()
    const app = Layer.provide(
      sessionsFromServiceLayer,
      Layer.mergeAll(Layer.succeed(SessionPersistenceService, persistence), HooksLive),
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const session = yield* sessions.create({ cwd: '/work' })
        return {
          types: session.events().map((event) => event.type),
          summaries: yield* sessions.list(),
        }
      }).pipe(Effect.provide(app)),
    )

    expect(result.types).toEqual(['session/header'])
    expect(result.summaries.map((summary) => summary.cwd)).toEqual(['/work'])
  })
})
