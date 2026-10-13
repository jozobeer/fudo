import { afterAll, describe, expect, test } from 'bun:test'
import { loadProfile } from '@fudo/kernel'
import { SESSION_FORMAT_VERSION, SessionPersistenceService } from '@fudo/session'
import { Context, Effect, Layer } from 'effect'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { sessionJsonlPlugin } from '../src/index.ts'

const tempRoot = join(import.meta.dir, '.tmp')

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('sessionJsonlPlugin', () => {
  test('provides a working JSONL store through the loader', async () => {
    const root = join(tempRoot, crypto.randomUUID())

    const opened = await Effect.runPromise(
      Effect.gen(function* () {
        const layer = yield* loadProfile({
          plugins: [sessionJsonlPlugin],
          layers: [[{ id: 'jsonl', name: '@fudo/session-jsonl', config: { root } }]],
        })
        const context = yield* Layer.build(layer)
        const persistence = Context.get(context, SessionPersistenceService)
        return yield* persistence.create({
          formatVersion: SESSION_FORMAT_VERSION,
          createdAt: 1,
          cwd: '/work',
        })
      }).pipe(Effect.scoped),
    )

    expect(opened.events.map((event) => event.type)).toEqual(['session/header'])
    expect(opened.id.length).toBeGreaterThan(0)
  })
})
