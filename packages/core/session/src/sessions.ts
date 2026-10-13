import { Hooks } from '@fudo/kernel'
import { Context, Effect, Layer } from 'effect'
import { SessionError } from './errors.ts'
import {
  SESSION_FORMAT_VERSION,
  type SessionHeader,
  type SessionId,
  type SessionEvent,
} from './events.ts'
import type { OpenedSession, SessionPersistence, SessionSummary } from './persistence.ts'
import { makeSession, type Session } from './session.ts'
import { SessionPersistenceService } from './service.ts'

export interface CreateSessionOptions {
  /** Events the new session starts from, e.g. a fork of another log. */
  readonly seed?: ReadonlyArray<SessionEvent>
  readonly cwd: string
}

export interface SessionsShape {
  create(options: CreateSessionOptions): Effect.Effect<Session, SessionError>
  open(id: SessionId): Effect.Effect<Session, SessionError>
  list(): Effect.Effect<ReadonlyArray<SessionSummary>, SessionError>
}

/** Registry of sessions. The persistence provider decides where logs live. */
export class Sessions extends Context.Service<Sessions, SessionsShape>()('fudo/Sessions') {}

export interface SessionsLayerOptions {
  readonly now?: () => number
}

/** Builds the session registry over one persistence provider. */
export function sessionsService(
  persistence: SessionPersistence,
  options?: SessionsLayerOptions,
): Effect.Effect<SessionsShape, never, Hooks> {
  return Effect.gen(function* () {
    const hooks = yield* Hooks
    const now = options?.now ?? Date.now

    const attach = (opened: OpenedSession): Effect.Effect<Session, SessionError> =>
      makeSession({
        id: opened.id,
        events: opened.events,
        sink: opened.sink,
        now,
        notify: (event) => hooks.emit('session/event', event),
      })

    return {
      create: (createOptions: CreateSessionOptions) =>
        Effect.gen(function* () {
          const header: SessionHeader = {
            formatVersion: SESSION_FORMAT_VERSION,
            createdAt: now(),
            cwd: createOptions.cwd,
          }
          const opened = yield* persistence.create(header)
          const seed = createOptions.seed ?? []
          if (seed.length === 0) return yield* attach(opened)
          for (const event of seed) {
            if (event.type === 'session/header') continue
            yield* opened.sink.append(event)
          }
          // Reopen so the session sees the events that were just written.
          return yield* attach(yield* persistence.open(opened.id))
        }),
      open: (id: SessionId) =>
        Effect.gen(function* () {
          const opened = yield* persistence.open(id)
          return yield* attach(opened)
        }),
      list: () => persistence.list(),
    }
  })
}

export function sessionsLayer(
  persistence: SessionPersistence,
  options?: SessionsLayerOptions,
): Layer.Layer<Sessions, never, Hooks> {
  return Layer.effect(Sessions, sessionsService(persistence, options))
}

/** The `Sessions` layer that resolves its provider from the context. */
export const sessionsFromServiceLayer: Layer.Layer<
  Sessions,
  never,
  SessionPersistenceService | Hooks
> = Layer.effect(
  Sessions,
  Effect.gen(function* () {
    const persistence = yield* SessionPersistenceService
    return yield* sessionsService(persistence)
  }),
)
