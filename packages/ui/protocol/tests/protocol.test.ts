import { describe, expect, test } from 'vitest'
import { Effect, Schema } from 'effect'
import { UiCommandSchema, UiEventSchema, type UiCommand, type UiEvent } from '../src/index.ts'

const decodeCommand = (input: unknown): Effect.Effect<UiCommand, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(UiCommandSchema)(input) as Effect.Effect<UiCommand, Schema.SchemaError>
const decodeEvent = (input: unknown): Effect.Effect<UiEvent, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(UiEventSchema)(input) as Effect.Effect<UiEvent, Schema.SchemaError>

describe('ui protocol', () => {
  test('every command survives a decode', async () => {
    const commands: ReadonlyArray<UiCommand> = [
      { kind: 'submit', text: 'hello' },
      { kind: 'approve', callId: 'call-1', approved: false },
      { kind: 'answer', id: 'ask-1', answer: 'yes' },
      { kind: 'cancel' },
    ]
    for (const command of commands) {
      expect(await Effect.runPromise(decodeCommand(command))).toEqual(command)
    }
  })

  test('an unknown command is rejected', async () => {
    const result = await Effect.runPromiseExit(decodeCommand({ kind: 'explode' }))
    expect(result._tag).toBe('Failure')
  })

  test('a session event keeps a plugin body as-is', async () => {
    const event: UiEvent = {
      kind: 'session',
      event: {
        seq: 7,
        time: 1_700_000_000_000,
        type: 'safety/approval/requested',
        data: { callId: 'c1', tool: 'bash', reason: 'outside the preset' },
      },
    }
    expect(await Effect.runPromise(decodeEvent(event))).toEqual(event)
  })

  test('a stream chunk decodes with its payload', async () => {
    const event: UiEvent = {
      kind: 'stream',
      chunk: { time: 5, chunk: { type: 'text-delta', index: 0, text: 'hi' } },
    }
    expect(await Effect.runPromise(decodeEvent(event))).toEqual(event)
  })
})
