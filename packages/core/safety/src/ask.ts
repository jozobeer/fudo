import { Context, Deferred, Effect, Layer } from 'effect'
import {
  registerSessionEventSchemas,
  type Session,
  type SessionEventSchemaMap,
} from '@fudo/session'
import { Schema } from 'effect'

/** A question for the user, with the choices the model offered. */
export interface AskRequested {
  readonly id: string
  readonly question: string
  readonly options: ReadonlyArray<string>
}

/** The answer to one question. */
export interface AskAnswered {
  readonly id: string
  readonly answer: string
}

declare module '@fudo/session/events' {
  interface SessionEventMap {
    'interaction/ask/requested': AskRequested
    'interaction/ask/answered': AskAnswered
  }
}

const AskRequestedSchema = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  options: Schema.Array(Schema.String),
})

const AskAnsweredSchema = Schema.Struct({
  id: Schema.String,
  answer: Schema.String,
})

/** Schemas for the session events this module adds. */
export const askEventSchemas: SessionEventSchemaMap = new Map<string, Schema.Schema<unknown>>([
  ['interaction/ask/requested', AskRequestedSchema],
  ['interaction/ask/answered', AskAnsweredSchema],
])

registerSessionEventSchemas(askEventSchemas)

export interface AskShape {
  /** Waits for the answer to one question. */
  readonly ask: (request: AskRequested) => Effect.Effect<string>
  /** Answers a pending question; false when nothing was waiting. */
  readonly answer: (id: string, answer: string) => Effect.Effect<boolean>
  readonly pending: () => ReadonlyArray<string>
}

/** Answers live in memory only: a question is asked once and never replayed. */
export const makeAsk = (): Effect.Effect<AskShape> =>
  Effect.sync(() => {
    const waiting = new Map<string, Deferred.Deferred<string>>()
    return {
      ask: (request) =>
        Effect.gen(function* () {
          const answer = yield* Deferred.make<string>()
          waiting.set(request.id, answer)
          return yield* Deferred.await(answer)
        }),
      answer: (id, answer) =>
        Effect.gen(function* () {
          const waitingFor = waiting.get(id)
          if (waitingFor === undefined) return false
          waiting.delete(id)
          yield* Deferred.succeed(waitingFor, answer)
          return true
        }),
      pending: () => waiting.keys().toArray(),
    }
  })

export class Ask extends Context.Service<Ask, AskShape>()('fudo/Ask') {}

export const askServiceLayer: Layer.Layer<Ask, never> = Layer.effect(Ask, makeAsk())

const log = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<boolean> =>
  Effect.match(effect, { onFailure: () => false, onSuccess: () => true })

/**
 * Wraps the ask holder so every question and answer lands in the session log.
 * A question that cannot be recorded is still asked, but the log will show the
 * gap rather than a silent question.
 */
export const installAsk = (ask: AskShape, session: Session): AskShape => ({
  ask: (request) =>
    Effect.gen(function* () {
      yield* log(session.append('interaction/ask/requested', request))
      const answer = yield* ask.ask(request)
      yield* log(session.append('interaction/ask/answered', { id: request.id, answer }))
      return answer
    }),
  answer: ask.answer,
  pending: ask.pending,
})
