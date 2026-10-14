import { forkSeed, type SessionEvent } from '@fudo/session'
import { Schema, Effect } from 'effect'
import type { Agent, AgentsShape } from '@fudo/agent'
import { ToolError, type ToolDefinition } from '@fudo/tools'

const Parameters = Schema.Struct({
  task: Schema.String.annotate({
    description: 'The whole task for the child, written as if the child sees nothing else.',
  }),
  cwd: Schema.optionalKey(
    Schema.String.annotate({
      description: 'The directory the child starts in. Defaults to this working directory.',
    }),
  ),
})

export type SubagentArgs = Schema.Schema.Type<typeof Parameters>

export interface SubagentValue {
  readonly sessionId: string
  readonly text: string
}

const textOf = (agent: Agent): string => {
  const events = agent.session.events()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'assistant/message') {
      return event.data.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('')
    }
  }
  return ''
}

/**
 * Runs one task in a child agent and answers with what it said. The child owns
 * its own session, so its work stays in the log next to the parent's.
 */
export interface SubagentHost {
  readonly agents: AgentsShape
  readonly route: string
  /** The parent's log; the child starts from it, minus the last instruction. */
  readonly parentEvents: () => ReadonlyArray<SessionEvent>
}

export const makeSubagentTool = ({
  agents,
  route,
  parentEvents,
}: SubagentHost): ToolDefinition<SubagentArgs, SubagentValue> => ({
  name: 'subagent',
  description:
    'Runs one task in a child agent and returns what it said. Delegate only work that needs none of this conversation: the child starts fresh.',
  parameters: Parameters,
  output: {
    schema: Schema.Struct({ sessionId: Schema.String, text: Schema.String }),
    // The session id rides along, so the parent can send the child more work or wait for it.
    render: (_args, value) => [
      { type: 'text', text: value.text + '\n\n[child session: ' + value.sessionId + ']' },
    ],
  },
  execute: (args, context) =>
    Effect.gen(function* () {
      const child = yield* agents
        .create({
          cwd: args.cwd ?? context.cwd,
          options: { route },
          seed: forkSeed(parentEvents()),
        })
        .pipe(
          Effect.mapError(
            () => new ToolError({ code: 'execution', message: 'cannot start a child agent' }),
          ),
        )
      yield* child
        .followup({ text: args.task, source: 'user' })
        .pipe(
          Effect.mapError(
            () => new ToolError({ code: 'execution', message: 'the child agent took no message' }),
          ),
        )
      yield* child.whenIdle
      return { sessionId: child.id, text: textOf(child) }
    }),
})
