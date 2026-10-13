import {
  AssistantStreamRecordSchema,
  ContentBlockSchema,
  LlmFailureSchema,
  LlmUsageSchema,
} from '@fudo/llm'
import { Schema } from 'effect'
import type { SessionEventMap, SessionEventType, TurnEndReason } from './events.ts'

const TurnEndReasonSchema: Schema.Schema<TurnEndReason> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('completed') }),
  Schema.Struct({
    kind: Schema.Literal('cancelled'),
    cause: Schema.Literals(['user', 'shutdown', 'parent-cancelled']),
  }),
  Schema.Struct({ kind: Schema.Literal('error'), failure: LlmFailureSchema }),
])

/** One runtime schema for every core event's data, used to read logs and replay. */
export const SessionEventSchemas: {
  readonly [K in SessionEventType]: Schema.Schema<SessionEventMap[K]>
} = {
  'session/header': Schema.Struct({
    formatVersion: Schema.Int,
    createdAt: Schema.Number,
    cwd: Schema.String,
  }),
  'turn/start': Schema.Struct({ turn: Schema.Int }),
  'turn/end': Schema.Struct({ turn: Schema.Int, reason: TurnEndReasonSchema }),
  'step/start': Schema.Struct({ step: Schema.Int }),
  'step/end': Schema.Struct({ step: Schema.Int }),
  'request/header': Schema.Struct({
    provider: Schema.String,
    model: Schema.String,
    params: Schema.Record(Schema.String, Schema.Unknown),
  }),
  'system/message': Schema.Struct({ text: Schema.String }),
  'user/message': Schema.Struct({
    text: Schema.String,
    source: Schema.Literals(['user', 'inject', 'runtime-context']),
  }),
  'assistant/message': Schema.Struct({
    provider: Schema.String,
    model: Schema.String,
    content: Schema.Array(ContentBlockSchema),
    usage: Schema.optionalKey(LlmUsageSchema),
    replayState: Schema.optionalKey(Schema.Unknown),
    stream: Schema.Array(AssistantStreamRecordSchema),
  }),
  'assistant/attempt': Schema.Struct({
    provider: Schema.String,
    model: Schema.String,
    failure: LlmFailureSchema,
    stream: Schema.Array(AssistantStreamRecordSchema),
  }),
  'tool/call': Schema.Struct({
    callId: Schema.String,
    name: Schema.String,
    arguments: Schema.String,
  }),
  'tool/result': Schema.Struct({
    callId: Schema.String,
    isError: Schema.Boolean,
    content: Schema.Array(ContentBlockSchema),
  }),
}
