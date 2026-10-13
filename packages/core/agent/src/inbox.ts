import type { Session, SessionError, SessionEvent } from '@fudo/session'
import { Effect } from 'effect'
import type { InboxTarget, UserMessage } from './events.ts'

/** Pending input reconstructed from the durable inbox events. */
export interface InboxState {
  readonly nextTurn: ReadonlyArray<UserMessage>
  readonly nextStep: ReadonlyArray<UserMessage>
}

const sameMessage = (left: UserMessage, right: UserMessage): boolean =>
  left.text === right.text && left.source === right.source

/**
 * Folds `agent/inbox/queued` and `agent/inbox/claimed` into the still-pending
 * input. Live agents and restored logs use the same fold.
 */
export function projectInbox(events: ReadonlyArray<SessionEvent>): InboxState {
  const nextTurn: Array<UserMessage> = []
  const nextStep: Array<UserMessage> = []
  for (const event of events) {
    if (event.type === 'agent/inbox/queued') {
      const target = event.data.target === 'next-turn' ? nextTurn : nextStep
      target.push(event.data.message)
      continue
    }
    if (event.type === 'agent/inbox/claimed') {
      const target = event.data.target === 'next-turn' ? nextTurn : nextStep
      const index = target.findIndex((message) => sameMessage(message, event.data.message))
      if (index >= 0) target.splice(index, 1)
    }
  }
  return { nextTurn, nextStep }
}

export interface Inbox {
  readonly nextTurn: ReadonlyArray<UserMessage>
  readonly nextStep: ReadonlyArray<UserMessage>
  readonly pending: boolean
  queue(target: InboxTarget, message: UserMessage): Effect.Effect<void, SessionError>
  /** Drains the step queue and, when `takeTurn`, one turn message. Step messages come first. */
  claim(takeTurn: boolean): Effect.Effect<ReadonlyArray<UserMessage>, SessionError>
}

/** Builds an inbox over one session. The log is the only source of pending input. */
export function makeInbox(session: Session): Inbox {
  const state = (): InboxState => projectInbox(session.events())
  const claimEvent = (target: InboxTarget, message: UserMessage) =>
    session.append('agent/inbox/claimed', { target, message })

  return {
    get nextTurn() {
      return state().nextTurn
    },
    get nextStep() {
      return state().nextStep
    },
    get pending() {
      const current = state()
      return current.nextTurn.length > 0 || current.nextStep.length > 0
    },

    queue: (target, message) => session.append('agent/inbox/queued', { target, message }),

    claim: (takeTurn) =>
      Effect.gen(function* () {
        const current = state()
        const turnMessage = takeTurn ? current.nextTurn[0] : undefined
        const claimed: Array<UserMessage> = [...current.nextStep]
        for (const message of current.nextStep) yield* claimEvent('next-step', message)
        if (turnMessage !== undefined) {
          claimed.push(turnMessage)
          yield* claimEvent('next-turn', turnMessage)
        }
        return claimed
      }),
  }
}
