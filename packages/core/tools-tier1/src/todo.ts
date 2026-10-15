import { Schema, Effect } from 'effect'
import type { ToolDefinition } from '@jozo-harness/tools'

const Todo = Schema.Struct({
  content: Schema.String.annotate({ description: 'What the step is, in one line.' }),
  status: Schema.Literals(['pending', 'in_progress', 'completed']).annotate({
    description: 'Where the step stands: pending, in_progress, or completed.',
  }),
})

const Parameters = Schema.Struct({
  todos: Schema.Array(Todo).annotate({
    description: 'The complete task list, in the order the work should happen.',
  }),
})

export type TodoArgs = Schema.Schema.Type<typeof Parameters>
export type TodoItem = Schema.Schema.Type<typeof Todo>

export interface TodoValue {
  readonly todos: ReadonlyArray<TodoItem>
  readonly counts: {
    readonly pending: number
    readonly inProgress: number
    readonly completed: number
  }
}

const marks: Readonly<Record<string, string>> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
}

/** Records the plan. The list is kept in the tool result, so it lives in the log. */
export const todoWriteTool: ToolDefinition<TodoArgs, TodoValue> = {
  name: 'todo_write',
  description:
    'Records the task list for the current work and keeps it in the tool result. Use it to keep a multi-step plan visible; update it as steps finish.',
  parameters: Parameters,
  output: {
    schema: Schema.Struct({
      todos: Schema.Array(Todo),
      counts: Schema.Struct({
        pending: Schema.Int,
        inProgress: Schema.Int,
        completed: Schema.Int,
      }),
    }),
    render: (_args, value) => [
      {
        type: 'text',
        text: value.todos
          .map((item) => (marks[item.status] ?? '[ ]') + ' ' + item.content)
          .join('\n'),
      },
    ],
  },
  execute: (args) =>
    Effect.succeed({
      todos: args.todos,
      counts: {
        pending: args.todos.filter((item) => item.status === 'pending').length,
        inProgress: args.todos.filter((item) => item.status === 'in_progress').length,
        completed: args.todos.filter((item) => item.status === 'completed').length,
      },
    }),
}
