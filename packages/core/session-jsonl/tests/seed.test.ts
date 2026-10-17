import { HooksLive } from '@jozo-harness/kernel'
import { Sessions, sessionsLayer, type SessionEvent } from '@jozo-harness/session'
import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { jsonlSessions } from '../src/index.ts'

const seed: SessionEvent = {
  seq: 9,
  time: 1,
  type: 'user/message',
  data: { text: 'from the parent', source: 'user' },
}

describe('a seeded session', () => {
  test('starts from the events it was given', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-seed-'))
    const layer = Layer.provideMerge(sessionsLayer(jsonlSessions({ root })), HooksLive)

    const types = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sessions = yield* Sessions
          const session = yield* sessions.create({ cwd: '/work', seed: [seed] })
          return session.events().map((event) => event.type)
        }).pipe(Effect.provide(layer)),
      ),
    )

    expect(types).toEqual(['session/header', 'user/message'])
    await rm(root, { recursive: true, force: true })
  })

  test('a header in the seed is not repeated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-seed-'))
    const layer = Layer.provideMerge(sessionsLayer(jsonlSessions({ root })), HooksLive)

    const types = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sessions = yield* Sessions
          const session = yield* sessions.create({
            cwd: '/work',
            seed: [
              {
                seq: 1,
                time: 0,
                type: 'session/header',
                data: { formatVersion: 1, createdAt: 0, cwd: '/other' },
              },
            ],
          })
          return session.events().map((event) => event.type)
        }).pipe(Effect.provide(layer)),
      ),
    )

    expect(types).toEqual(['session/header'])
    await rm(root, { recursive: true, force: true })
  })
})
