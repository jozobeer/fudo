import type { RequestMessage } from '@fudo/llm'
import type { SessionEvent } from './events.ts'

/** A plugin's view of the model history, applied in registration order. */
export interface MessageProjection {
  readonly name: string
  readonly project: (
    messages: ReadonlyArray<RequestMessage>,
    events: ReadonlyArray<SessionEvent>,
  ) => ReadonlyArray<RequestMessage>
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

/** Folds an event log into the model history. The log is the only source. */
export function deriveMessages(
  events: ReadonlyArray<SessionEvent>,
  projections: ReadonlyArray<MessageProjection> = [],
): ReadonlyArray<RequestMessage> {
  const messages: Array<RequestMessage> = []
  for (const event of events) messages.push(...toMessage(event))
  let current: ReadonlyArray<RequestMessage> = messages
  for (const projection of projections) current = projection.project(current, events)
  return current
}
