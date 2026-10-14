import type { ContentBlock } from '@fudo/llm'
import { deriveMessagesWithSeqs, prunedSeqs, type DerivedMessage } from './derive.ts'
import type { CompactReplacement, CompactionPrune, SessionEvent } from './events.ts'
import { registerMessageProjection, type MessageProjection } from './projections.ts'

export interface CompactOptions {
  /** Messages at the end that are never touched. */
  readonly keepLast: number
  /** Text blocks larger than this many bytes are replaced by a shorter form. */
  readonly maxBytes: number
}

/** What a profile gets when its agent-loop row names no threshold. */
export const DEFAULT_COMPACT_KEEP_LAST = 12
export const DEFAULT_COMPACT_MAX_BYTES = 32_000

const bytesOf = (text: string): number => new TextEncoder().encode(text).length

const stub = (text: string): ContentBlock => ({
  type: 'text',
  text: '[earlier output of ' + String(bytesOf(text)) + ' bytes] ' + text.slice(0, 120),
})

interface PrunedBlocks {
  readonly content: ReadonlyArray<ContentBlock>
  /** Whether the request carries something other than this content. */
  readonly changed: boolean
  /** What the request no longer carries, in bytes. */
  readonly replacedBytes: number
}

/** Reasoning is dropped and oversized text is stubbed; the newest messages never reach here. */
const pruneBlocks = (content: ReadonlyArray<ContentBlock>, maxBytes: number): PrunedBlocks => {
  let changed = false
  let replacedBytes = 0
  const kept: Array<ContentBlock> = []
  for (const block of content) {
    if (block.type === 'reasoning') {
      changed = true
      continue
    }
    if (block.type === 'text' && bytesOf(block.text) > maxBytes) {
      replacedBytes += bytesOf(block.text)
      kept.push(stub(block.text))
      changed = true
      continue
    }
    kept.push(block)
  }
  return { content: kept, changed, replacedBytes }
}

/** Replaces the content of the events the prune names, wherever they landed. */
const applyReplacements = (
  derived: ReadonlyArray<DerivedMessage>,
  replacements: ReadonlyArray<CompactReplacement>,
): ReadonlyArray<DerivedMessage> => {
  const bySeq = new Map(replacements.map((replacement) => [replacement.seq, replacement.content]))
  return derived.map((entry) => {
    const content = bySeq.get(entry.seq)
    return content === undefined
      ? entry
      : { seq: entry.seq, message: { ...entry.message, content } }
  })
}

/**
 * The projection the session actually uses: a recorded prune rewrites the content
 * of the events it shadows, so the request and the log stay the same thing.
 */
export const pruneProjection: MessageProjection = {
  type: 'compaction/prune',
  name: 'compaction/prune',
  project: (event, derived) =>
    event.type === 'compaction/prune'
      ? applyReplacements(derived, event.data.replacements)
      : derived,
}

registerMessageProjection(pruneProjection)

/**
 * What the next request stops carrying: every message outside the retention whose
 * content is over the price, with what it carries instead. Pure, so the loop can
 * record the decision before the request that follows it. An already-pruned log
 * yields nothing, so recording it again is not possible.
 */
export function pruneFor(
  events: ReadonlyArray<SessionEvent>,
  options: CompactOptions,
): CompactionPrune | undefined {
  const derived = deriveMessagesWithSeqs(events)
  const boundary = Math.max(0, derived.length - options.keepLast)
  const alreadyPruned = prunedSeqs(events)
  // The system prompt is the request's frame, not history: a prune never hides it.
  const frame = new Set(
    events.filter((event) => event.type === 'system/message').map((event) => event.seq),
  )
  const replacements: Array<CompactReplacement> = []
  let shadowedBytes = 0

  derived.forEach((entry, index) => {
    if (index >= boundary || alreadyPruned.has(entry.seq) || frame.has(entry.seq)) return
    const pruned = pruneBlocks(entry.message.content, options.maxBytes)
    if (!pruned.changed) return
    shadowedBytes += pruned.replacedBytes
    replacements.push({ seq: entry.seq, content: pruned.content })
  })
  if (replacements.length === 0) return undefined

  const seqs = replacements.map((replacement) => replacement.seq)
  return {
    shadowedSeqs: seqs,
    shadowedRange: { start: Math.min(...seqs), end: Math.max(...seqs) },
    shadowedBytes,
    replacements,
  }
}
