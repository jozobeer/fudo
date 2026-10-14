import { SessionError } from './errors.ts'
import type { DerivedMessage } from './derive.ts'
import type { SessionEvent, SessionEventType } from './events.ts'

/**
 * A session-event view that turns one event into model history. A projection owns
 * exactly one event type, so a log that names that type can always be folded.
 */
export interface MessageProjection {
  readonly type: SessionEventType
  readonly name: string
  /**
   * Rewrites the history derived so far. An event may add, drop, or change
   * messages; returning the input unchanged means it contributes no message.
   */
  readonly project: (
    event: SessionEvent,
    derived: ReadonlyArray<DerivedMessage>,
  ) => ReadonlyArray<DerivedMessage>
}

const registered = new Map<SessionEventType, MessageProjection>()
const logOnly = new Set<SessionEventType>()

/**
 * Declares event types a package adds that never reach the model. A type that is
 * neither projected nor declared fails the fold instead of disappearing.
 */
export function registerLogOnlySessionEvents(types: ReadonlyArray<SessionEventType>): void {
  for (const type of types) logOnly.add(type)
}

/** Registers the projection of one event type. A duplicate type fails at load. */
export function registerMessageProjection(projection: MessageProjection): void {
  if (registered.has(projection.type)) {
    throw new SessionError({
      code: 'projection',
      message: `a message projection for "${projection.type}" is already registered`,
    })
  }
  registered.set(projection.type, projection)
}

/** The projections every fold starts from. */
export const messageProjections = (): ReadonlyMap<SessionEventType, MessageProjection> => registered

/** The declared event types that are log-only. */
export const logOnlyEventTypes = (): ReadonlySet<SessionEventType> => logOnly
