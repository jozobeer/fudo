import { Schema, Effect } from 'effect'
import type { AskShape } from '@fudo/safety'
import type { ToolDefinition } from '@fudo/tools'

const Parameters = Schema.Struct({
  question: Schema.String,
  options: Schema.optionalKey(Schema.Array(Schema.String)),
})

export type AskArgs = Schema.Schema.Type<typeof Parameters>

export interface AskValue {
  readonly id: string
  readonly question: string
  readonly answer: string
}

/**
 * Asks the user one question and waits for the answer. The question id is the
 * call id, so the request and the answer line up in the log.
 */
export const askUserToolFor = (ask: AskShape): ToolDefinition<AskArgs, AskValue> => ({
  name: 'ask_user',
  description: 'Asks the user one question and waits for the answer.',
  parameters: Parameters,
  output: {
    schema: Schema.Struct({ id: Schema.String, question: Schema.String, answer: Schema.String }),
    render: (_args, value) => [{ type: 'text', text: value.answer }],
  },
  execute: (args, context) =>
    Effect.gen(function* () {
      const answer = yield* ask.ask({
        id: context.callId,
        question: args.question,
        options: args.options ?? [],
      })
      return { id: context.callId, question: args.question, answer }
    }),
})

/** The default ask tool, using whatever holder the caller passes. */
export const makeAskUserTool = askUserToolFor
