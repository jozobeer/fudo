import { Hooks } from '@fudo/kernel'
import { Context, Effect, Layer } from 'effect'
import { SessionError } from './errors.ts'
import { SESSION_FORMAT_VERSION, type SessionHeader, type SessionId } from './events.ts'
import type { OpenedSession, SessionPersistence, SessionSummary } from './persistence.ts'
import { makeSession, type Session } from './session.ts'

export interface CreateSessionOptions {
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

export function sessionsLayer(
  persistence: SessionPersistence,
  options?: SessionsLayerOptions,
): Layer.Layer<Sessions, never, Hooks> {
  return Layer.effect(
    Sessions,
    Effect.gen(function* () {
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
            return yield* attach(opened)
          }),
        open: (id: SessionId) =>
          Effect.gen(function* () {
            const opened = yield* persistence.open(id)
            return yield* attach(opened)
          }),
        list: () => persistence.list(),
      }
    }),
  )
}
