import { Schema } from 'effect'
import {
  registerLogOnlySessionEvents,
  registerSessionEventSchemas,
  type SessionEvent,
  type SessionEventSchemaMap,
} from '@fudo/session'

/** One named child of this session. */
export interface TeamMember {
  readonly name: string
  readonly role: string
  readonly sessionId: string
}

/** Where one piece of shared work stands. */
export type TeamTaskState = 'pending' | 'doing' | 'done' | 'blocked'

/** One row of the shared board. */
export interface TeamTask {
  readonly id: string
  readonly title: string
  readonly state: TeamTaskState
  /** Whose work it is, once someone took it. */
  readonly owner?: string
  /** How many times the row changed; a caller passes the one it read. */
  readonly revision: number
}

declare module '@fudo/session/events' {
  interface SessionEventMap {
    'team/spawned': TeamMember
    'team/task/created': { readonly task: TeamTask }
    'team/task/updated': { readonly task: TeamTask }
  }
}

const TeamTaskSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  state: Schema.Literals(['pending', 'doing', 'done', 'blocked']),
  owner: Schema.optionalKey(Schema.String),
  revision: Schema.Int,
})

/** Schemas for the session events this module adds. */
export const teamEventSchemas: SessionEventSchemaMap = new Map<string, Schema.Schema<unknown>>([
  [
    'team/spawned',
    Schema.Struct({ name: Schema.String, role: Schema.String, sessionId: Schema.String }),
  ],
  ['team/task/created', Schema.Struct({ task: TeamTaskSchema })],
  ['team/task/updated', Schema.Struct({ task: TeamTaskSchema })],
])

registerSessionEventSchemas(teamEventSchemas)
// The roster and the board are the lead's bookkeeping; the model reads them from its own calls.
registerLogOnlySessionEvents(['team/spawned', 'team/task/created', 'team/task/updated'])

/** The named children this session has, in the order they were spawned. */
export const teamRoster = (events: ReadonlyArray<SessionEvent>): ReadonlyArray<TeamMember> =>
  events.flatMap((event) => (event.type === 'team/spawned' ? [event.data] : []))

/** The shared board, one row per task, in the order the tasks were created. */
export const teamTasks = (events: ReadonlyArray<SessionEvent>): ReadonlyArray<TeamTask> => {
  const byId = new Map<string, TeamTask>()
  for (const event of events) {
    if (event.type !== 'team/task/created' && event.type !== 'team/task/updated') continue
    const current = byId.get(event.data.task.id)
    if (current === undefined || event.data.task.revision >= current.revision) {
      byId.set(event.data.task.id, event.data.task)
    }
  }
  return [...byId.values()]
}

/** One row of the board, or nothing when the board has no such task. */
export const taskOf = (events: ReadonlyArray<SessionEvent>, id: string): TeamTask | undefined =>
  teamTasks(events).find((task) => task.id === id)
