import type { ContentBlock } from '@fudo/llm'
import type { SessionEvent } from './events.ts'

/** What one token is estimated to carry when only bytes are known. */
export const BYTES_PER_TOKEN = 4

/** The routed model's context window, and how close to it a request may come. */
export interface TokenBudget {
  /** The model's context window, in tokens. */
  readonly contextWindow: number
  /** Compact when the estimate reaches this fraction of the window. */
  readonly thresholdRatio: number
  /** Always leave this many tokens between the threshold and the window. */
  readonly headroomTokens: number
}

/** The pressure line: the tighter of the window fraction and the room after headroom. */
export const thresholdOf = (budget: TokenBudget): number =>
  Math.max(
    1,
    Math.min(
      Math.floor(budget.contextWindow * budget.thresholdRatio),
      budget.contextWindow - budget.headroomTokens,
    ),
  )

/** Where the estimate came from: what the provider last counted, or bytes alone. */
export type TokenMeterSource = 'usage' | 'bytes'

export interface TokenMeter {
  /** The tokens the next request is estimated to carry. */
  readonly estimated: number
  /** Where compaction fires. */
  readonly threshold: number
  /** Tokens still free before the threshold; negative means the request is past it. */
  readonly remaining: number
  /** Whether the estimate reached the threshold: the condition compaction fires on. */
  readonly compacts: boolean
  readonly source: TokenMeterSource
}

const ENCODER = new TextEncoder()

const bytesOf = (text: string): number => ENCODER.encode(text).length

const blockBytes = (block: ContentBlock): number => {
  if (block.type === 'text' || block.type === 'reasoning') return bytesOf(block.text)
  if (block.type === 'image') return block.data.length
  return bytesOf(block.name + block.arguments)
}

/**
 * The bytes one event adds to a request. Only what the provider is sent counts:
 * the recorded stream and the timestamp are the log's own, not the request's.
 */
const eventBytes = (event: SessionEvent): number => {
  switch (event.type) {
    case 'system/message':
    case 'user/message':
      return bytesOf(event.data.text)
    case 'assistant/message':
    case 'tool/result':
      return event.data.content.reduce((sum, block) => sum + blockBytes(block), 0)
    default:
      return 0
  }
}

/**
 * The newest provider count in the log, as the tokens that one request carried.
 * Everything up to and including its answer is already inside the number.
 */
const newestUsage = (
  events: ReadonlyArray<SessionEvent>,
): { readonly seq: number; readonly tokens: number } | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message' || event.data.usage === undefined) continue
    const usage = event.data.usage
    return { seq: event.seq, tokens: usage.inputTokens + usage.outputTokens }
  }
  return undefined
}

/**
 * The pressure of the next request, read from the log alone: the newest provider
 * usage when there is one, plus an estimate of everything appended since. The
 * estimate is what decides whether compaction fires, so a resumed session
 * measures the same way as a live one.
 */
export const meterOf = (events: ReadonlyArray<SessionEvent>, budget: TokenBudget): TokenMeter => {
  const anchor = newestUsage(events)
  const bytes = events.reduce(
    (sum, event) => sum + (anchor !== undefined && event.seq <= anchor.seq ? 0 : eventBytes(event)),
    0,
  )
  const estimated = (anchor?.tokens ?? 0) + Math.ceil(bytes / BYTES_PER_TOKEN)
  const threshold = thresholdOf(budget)
  return {
    estimated,
    threshold,
    remaining: threshold - estimated,
    compacts: estimated >= threshold,
    source: anchor === undefined ? 'bytes' : 'usage',
  }
}
