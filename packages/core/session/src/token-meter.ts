import type { ContentBlock, RequestMessage } from '@jozo-harness/llm'
import { deriveMessagesWithSeqs } from './derive.ts'
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

/** What one message adds to a request, as the request carries it after the fold. */
const messageBytes = (message: RequestMessage): number =>
  message.content.reduce((sum, block) => sum + blockBytes(block), 0)

/**
 * What one message is estimated to carry. The meter's own rule, so a whole request
 * and the tail a compaction retains are counted the same way.
 */
export const messageTokens = (message: RequestMessage): number =>
  Math.ceil(messageBytes(message) / BYTES_PER_TOKEN)

/** The bytes the fold would send for a log, with every recorded compaction applied. */
const foldedBytes = (events: ReadonlyArray<SessionEvent>): number =>
  deriveMessagesWithSeqs(events).reduce((sum, entry) => sum + messageBytes(entry.message), 0)

/**
 * The newest provider count in the log, as the tokens that one request carried.
 * Everything up to and including its answer is already inside the number.
 */
const newestUsage = (
  events: ReadonlyArray<SessionEvent>,
): { readonly index: number; readonly tokens: number } | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message' || event.data.usage === undefined) continue
    const usage = event.data.usage
    return { index, tokens: usage.inputTokens + usage.outputTokens }
  }
  return undefined
}

/**
 * The pressure of the next request, read from the log alone: the newest provider
 * usage when there is one, plus an estimate of everything the fold gained or lost
 * since. What the fold carries is what gets sent, so a recorded compaction lowers
 * the estimate at the step it is recorded rather than one provider round trip later.
 * A resumed session measures the same way as a live one.
 */
export const meterOf = (events: ReadonlyArray<SessionEvent>, budget: TokenBudget): TokenMeter => {
  const anchor = newestUsage(events)
  const counted = anchor === undefined ? 0 : foldedBytes(events.slice(0, anchor.index + 1))
  const estimated = Math.max(
    0,
    (anchor?.tokens ?? 0) + Math.ceil((foldedBytes(events) - counted) / BYTES_PER_TOKEN),
  )
  const threshold = thresholdOf(budget)
  return {
    estimated,
    threshold,
    remaining: threshold - estimated,
    compacts: estimated >= threshold,
    source: anchor === undefined ? 'bytes' : 'usage',
  }
}
