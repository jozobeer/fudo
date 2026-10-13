import { Schema, Effect } from 'effect'
import type { ToolDefinition } from '@fudo/tools'

const Parameters = Schema.Struct({
  objective: Schema.String,
  note: Schema.optionalKey(Schema.String),
})

export type GoalArgs = Schema.Schema.Type<typeof Parameters>

export interface GoalValue {
  readonly objective: string
  readonly note?: string
}

/** Records the objective as a tool result, so the log keeps what the work was for. */
export const goalTool: ToolDefinition<GoalArgs, GoalValue> = {
  name: 'goal',
  description: 'Records the objective this work pursues; it is stored as the tool result.',
  parameters: Parameters,
  output: {
    schema: Schema.Struct({ objective: Schema.String, note: Schema.optionalKey(Schema.String) }),
    render: (_args, value) => [
      {
        type: 'text',
        text: value.note === undefined ? value.objective : value.objective + '\n' + value.note,
      },
    ],
  },
  execute: (args) => Effect.succeed(args.note === undefined ? { objective: args.objective } : args),
}
