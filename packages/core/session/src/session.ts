import { Effect } from 'effect'
import type { RequestMessage } from '@fudo/llm'
import { deriveMessages, type MessageProjection } from './derive.ts'
import { SessionError } from './errors.ts'
import type { SessionEvent, SessionEventMap, SessionHeader, SessionId } from './events.ts'
import { isJsonValue } from './json.ts'
import type { SessionSink } from './persistence.ts'

export interface AppendOptions {
  readonly ignorable?: true
}

/** One live, append-only session log. */
export interface Session {
  readonly id: SessionId
  readonly header: SessionHeader
  /** Snapshot of the log so far. */
  events(): ReadonlyArray<SessionEvent>
  append<K extends keyof SessionEventMap>(
    type: K,
    data: SessionEventMap[K],
    options?: AppendOptions,
  ): Effect.Effect<void, SessionError>
  flush(): Effect.Effect<void, SessionError>
  derive(projections?: ReadonlyArray<MessageProjection>): ReadonlyArray<RequestMessage>
}

export interface MakeSessionOptions {
  readonly id: SessionId
  /** The restored log. Must start with `session/header`. */
  readonly events: ReadonlyArray<SessionEvent>
  readonly sink: SessionSink
  readonly now?: () => number
  readonly notify?: (event: SessionEvent) => Effect.Effect<void, unknown>
}

/** Builds a session over a restored log and its sink. */
export function makeSession(options: MakeSessionOptions): Effect.Effect<Session, SessionError> {
  return Effect.gen(function* () {
    const first = options.events[0]
    if (first === undefined || first.type !== 'session/header') {
      return yield* Effect.fail(
        new SessionError({
          code: 'persistence',
          message: 'a session log must start with session/header',
        }),
      )
    }
    const log: Array<SessionEvent> = [...options.events]
    const now = options.now ?? Date.now

    const append = <K extends keyof SessionEventMap>(
      type: K,
      data: SessionEventMap[K],
      appendOptions?: AppendOptions,
    ): Effect.Effect<void, SessionError> =>
      Effect.gen(function* () {
        if (!isJsonValue(data)) {
          return yield* Effect.fail(
            new SessionError({
              code: 'not-serializable',
              message: `${String(type)} data cannot be stored as JSON`,
            }),
          )
        }
        const event = {
          seq: log.length + 1,
          time: now(),
          type,
          data,
          ...(appendOptions?.ignorable === true ? { ignorable: true as const } : {}),
        } as SessionEvent
        yield* options.sink.append(event)
        log.push(event)
        if (options.notify !== undefined) {
          yield* options
            .notify(event)
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError('session/event observer failed', { cause }),
              ),
            )
        }
      })

    return {
      id: options.id,
      header: first.data,
      events: () => [...log],
      append,
      flush: options.sink.flush,
      derive: (projections?: ReadonlyArray<MessageProjection>) => deriveMessages(log, projections),
    }
  })
}
