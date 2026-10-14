import {
  registerLogOnlySessionEvents,
  registerSessionEventSchemas,
  type SessionEventSchemaMap,
} from '@fudo/session'
import { Schema } from 'effect'

/** Asks the user to let one call run outside the preset. */
export interface ApprovalRequested {
  readonly callId: string
  readonly tool: string
  readonly reason: string
}

/** The answer to one request. Approval is one call wide, never remembered. */
export interface ApprovalAnswered {
  readonly callId: string
  readonly approved: boolean
}

declare module '@fudo/session/events' {
  interface SessionEventMap {
    'safety/approval/requested': ApprovalRequested
    'safety/approval/answered': ApprovalAnswered
  }
}

const ApprovalRequestedSchema = Schema.Struct({
  callId: Schema.String,
  tool: Schema.String,
  reason: Schema.String,
})

const ApprovalAnsweredSchema = Schema.Struct({
  callId: Schema.String,
  approved: Schema.Boolean,
})

/** Schemas for the session events this package adds. */
export const approvalEventSchemas: SessionEventSchemaMap = new Map<string, Schema.Schema<unknown>>([
  ['safety/approval/requested', ApprovalRequestedSchema],
  ['safety/approval/answered', ApprovalAnsweredSchema],
])

// Logs written here stay readable by every provider, not only by callers that
// pass the map explicitly.
registerSessionEventSchemas(approvalEventSchemas)
// Approvals are shown by the UI and never join the model history.
registerLogOnlySessionEvents(['safety/approval/requested', 'safety/approval/answered'])
