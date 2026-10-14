import type { ContentBlock, RequestMessage } from '@fudo/llm'
import type { SessionEvent, SessionSeq } from './events.ts'

/** A plugin's view of the model history, applied in registration order. */
export interface MessageProjection {
  readonly name: string
  readonly project: (
    messages: ReadonlyArray<RequestMessage>,
    events: ReadonlyArray<SessionEvent>,
  ) => ReadonlyArray<RequestMessage>
}

/** One model message with the event that produced it; pruning needs the seq back. */
export interface DerivedMessage {
  readonly seq: SessionSeq
  readonly message: RequestMessage
}

const toMessage = (event: SessionEvent): ReadonlyArray<RequestMessage> => {
  switch (event.type) {
    case 'system/message':
      return [{ role: 'system', content: [{ type: 'text', text: event.data.text }] }]
    case 'user/message':
      return [{ role: 'user', content: [{ type: 'text', text: event.data.text }] }]
    case 'assistant/message':
      return [{ role: 'assistant', content: event.data.content }]
    case 'tool/result':
      return [{ role: 'tool', toolCallId: event.data.callId, content: event.data.content }]
    // A default is honest here: plugins add event types by declaration merging, and
    // those do not reach the model unless a projection puts them there.
    default:
      return []
  }
}

/** What every recorded prune carries for the event it shadows, newest record wins. */
const replacementsOf = (
  events: ReadonlyArray<SessionEvent>,
): ReadonlyMap<SessionSeq, ReadonlyArray<ContentBlock>> => {
  const replacements = new Map<SessionSeq, ReadonlyArray<ContentBlock>>()
  for (const event of events) {
    if (event.type !== 'compaction/prune') continue
    for (const replacement of event.data.replacements) {
      replacements.set(replacement.seq, replacement.content)
    }
  }
  return replacements
}

/** The events a recorded prune already shadows; a later prune leaves them alone. */
export const prunedSeqs = (events: ReadonlyArray<SessionEvent>): ReadonlySet<SessionSeq> =>
  new Set(replacementsOf(events).keys())

/** The messages one event produces, with a recorded replacement where there is one. */
const messagesOf = (
  event: SessionEvent,
  replacements: ReadonlyMap<SessionSeq, ReadonlyArray<ContentBlock>>,
): ReadonlyArray<RequestMessage> => {
  const content = replacements.get(event.seq)
  return toMessage(event).map((message) =>
    content === undefined ? message : { ...message, content },
  )
}

/**
 * Folds an event log into model history, keeping the event each message came from.
 * A `compaction/prune` event replaces the content of the events it names and
 * carries no message of its own, so the request is exactly what the log implies.
 */
export function deriveMessagesWithSeqs(
  events: ReadonlyArray<SessionEvent>,
): ReadonlyArray<DerivedMessage> {
  const replacements = replacementsOf(events)
  const derived: Array<DerivedMessage> = []
  for (const event of events) {
    if (event.type === 'compaction/prune') continue
    for (const message of messagesOf(event, replacements)) {
      derived.push({ seq: event.seq, message })
    }
  }
  return derived
}

/** Folds an event log into the model history. The log is the only source. */
export function deriveMessages(
  events: ReadonlyArray<SessionEvent>,
  projections: ReadonlyArray<MessageProjection> = [],
): ReadonlyArray<RequestMessage> {
  let current: ReadonlyArray<RequestMessage> = deriveMessagesWithSeqs(events).map(
    (entry) => entry.message,
  )
  for (const projection of projections) current = projection.project(current, events)
  return current
}
