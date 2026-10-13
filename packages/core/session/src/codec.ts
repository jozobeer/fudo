import { Effect, Schema } from 'effect'
import { SessionError } from './errors.ts'
import type { SessionEvent } from './events.ts'
import { SessionEventSchemas, type SessionEventSchemaMap } from './schemas.ts'

const EnvelopeSchema = Schema.Struct({
  seq: Schema.Int,
  time: Schema.Number,
  type: Schema.String,
  data: Schema.Unknown,
  ignorable: Schema.optionalKey(Schema.Literal(true)),
})

const invalid = (message: string): SessionError =>
  new SessionError({ code: 'persistence', message })

/**
 * Decodes one logged event. An unknown type is skipped only when the record
 * carries `ignorable: true`; otherwise the log cannot be read correctly.
 *
 * @returns the event, or undefined for a skipped unknown event.
 */
export function decodeSessionEvent(
  value: unknown,
  schemas: SessionEventSchemaMap = SessionEventSchemas,
): Effect.Effect<SessionEvent | undefined, SessionError> {
  return Effect.gen(function* () {
    const envelope = yield* Schema.decodeUnknownEffect(EnvelopeSchema)(value).pipe(
      Effect.mapError((issue) => invalid(`invalid session event envelope: ${issue.message}`)),
    ) as Effect.Effect<(typeof EnvelopeSchema)['Type'], SessionError, never>
    const schema = schemas.get(envelope.type)
    if (schema === undefined) {
      if (envelope.ignorable === true) return undefined
      return yield* Effect.fail(invalid(`unknown session event type ${envelope.type}`))
    }
    const data = yield* Schema.decodeUnknownEffect(schema)(envelope.data).pipe(
      Effect.mapError((issue) => invalid(`invalid ${envelope.type} data: ${issue.message}`)),
    ) as Effect.Effect<unknown, SessionError, never>
    return {
      seq: envelope.seq,
      time: envelope.time,
      type: envelope.type,
      data,
      ...(envelope.ignorable === true ? { ignorable: true as const } : {}),
    } as SessionEvent
  })
}
