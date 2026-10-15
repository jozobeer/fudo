import type { Agent } from '@jozo-harness/agent'

/** The last text a child agent said: the answer its parent reads back from the log. */
export const childAnswerOf = (agent: Agent): string => {
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
