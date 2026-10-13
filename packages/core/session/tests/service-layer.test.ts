import { describe, expect, test } from 'bun:test'
import { Hooks, HooksLive, loadProfile, type Plugin } from '@fudo/kernel'
import { Context, Effect, Layer, Schema } from 'effect'
import {
  Sessions,
  SessionPersistenceService,
  sessionPlugin,
  sessionsFromServiceLayer,
} from '../src/index.ts'
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

describe('session plugin through the loader', () => {
  test('resolves a provider row and serves the sessions', async () => {
    const persistence = makeFakePersistence()
    const providerPlugin: Plugin<{}, SessionPersistenceService, never> = {
      name: 'provider',
      config: Schema.Struct({}),
      provides: [SessionPersistenceService],
      requires: [],
      layer: () => Layer.succeed(SessionPersistenceService, persistence),
    }
    const hooksPlugin: Plugin<{}, Hooks, never> = {
      name: 'hooks',
      config: Schema.Struct({}),
      provides: [Hooks],
      requires: [],
      layer: () => HooksLive,
    }

    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const layer = yield* loadProfile({
          plugins: [hooksPlugin, providerPlugin, sessionPlugin],
          layers: [
            [
              { id: 'hooks', name: 'hooks', config: {} },
              { id: 'provider', name: 'provider', config: {} },
              { id: 'session', name: '@fudo/session', config: {} },
            ],
          ],
        })
        const context = yield* Layer.build(layer)
        const session = yield* Context.get(context, Sessions).create({ cwd: '/work' })
        return session.events().map((event) => event.type)
      }).pipe(Effect.scoped),
    )

    expect(events).toEqual(['session/header'])
  })
})
