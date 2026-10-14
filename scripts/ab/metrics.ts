/**
 * What the A/B counts: tool calls, failed edits, re-reads of a file already
 * read, and turns. Both harnesses keep an append-only JSONL log and spell the
 * call the same way; only the result's failure flag sits in a different place,
 * which is what the two shapes below say.
 */

export interface AbMetrics {
  readonly toolCalls: number
  /** Edit calls whose result came back as an error. */
  readonly failedEdits: number
  /** Read calls for a path this same session had already read. */
  readonly reReads: number
  readonly turns: number
  readonly tools: Readonly<Record<string, number>>
}

interface AbEvent {
  readonly type?: unknown
  readonly data?: unknown
}

/** Where one log keeps the fact that a tool result failed. */
interface LogShape {
  /** The call a failed result answers, or undefined when the result is not a failure. */
  readonly failedCallOf: (data: Record<string, unknown>) => string | undefined
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const stringOf = (value: unknown): string => (typeof value === 'string' ? value : '')

const argumentsOf = (raw: unknown): Record<string, unknown> | undefined => {
  if (typeof raw !== 'string') return asRecord(raw)
  try {
    return asRecord(JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

/** Both logs name a call the same way, with the arguments as a JSON string. */
const callOf = (data: Record<string, unknown>) => ({
  name: stringOf(data['name']),
  callId: stringOf(data['callId']),
  arguments: data['arguments'],
})

const count = (events: ReadonlyArray<AbEvent>, shape: LogShape): AbMetrics => {
  const tools = new Map<string, number>()
  const readPaths = new Set<string>()
  const callNames = new Map<string, string>()
  let toolCalls = 0
  let failedEdits = 0
  let reReads = 0
  let turns = 0

  for (const event of events) {
    const data = asRecord(event.data)
    if (data === undefined) continue
    if (event.type === 'turn/start') turns += 1
    if (event.type === 'tool/call') {
      const call = callOf(data)
      toolCalls += 1
      tools.set(call.name, (tools.get(call.name) ?? 0) + 1)
      callNames.set(call.callId, call.name)
      if (call.name === 'read') {
        const path = stringOf(argumentsOf(call.arguments)?.['path'])
        if (path !== '') {
          if (readPaths.has(path)) reReads += 1
          readPaths.add(path)
        }
      }
    }
    if (event.type === 'tool/result') {
      const callId = shape.failedCallOf(data)
      if (callId !== undefined && callNames.get(callId) === 'edit') failedEdits += 1
    }
  }
  return { toolCalls, failedEdits, reReads, turns, tools: Object.fromEntries(tools) }
}

/** The fudo log carries the failure flat on the result's data. */
export const fudoMetrics = (events: ReadonlyArray<AbEvent>): AbMetrics =>
  count(events, {
    failedCallOf: (data) => (data['isError'] === true ? stringOf(data['callId']) : undefined),
  })

/** The dsh log nests the result's message, and its failure sits inside it. */
export const dshMetrics = (events: ReadonlyArray<AbEvent>): AbMetrics =>
  count(events, {
    failedCallOf: (data) => {
      const message = asRecord(data['message'])
      return message?.['isError'] === true ? stringOf(message['toolCallId']) : undefined
    },
  })
