import { afterAll, describe, expect, test } from 'bun:test'
import { loadProfile } from '@jozo-harness/kernel'
import { SESSION_FORMAT_VERSION, SessionPersistenceService } from '@jozo-harness/session'
import { Context, Effect, Layer } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionJsonlPlugin } from '../src/index.ts'

/** A root this test process owns; one under the repo is shared with every other process. */
const tempRoot = await mkdtemp(join(tmpdir(), 'jozo-harness-jsonl-plugin-'))

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
          layers: [[{ id: 'jsonl', name: '@jozo-harness/session-jsonl', config: { root } }]],
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
