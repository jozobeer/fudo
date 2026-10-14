import type { ContentBlock, RequestMessage } from '@fudo/llm'
import { deriveMessagesWithSeqs, prunedSeqs, type DerivedMessage } from './derive.ts'
import type {
  CompactReplacement,
  CompactionCheckpoint,
  CompactionPrune,
  SessionEvent,
  SessionSeq,
} from './events.ts'
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

/** The line a checkpoint message opens with: the model reads it as background. */
export const CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the ' +
  'conversation. Treat it as established background and continue from the messages ' +
  'that follow, without acknowledging it.\n\n'

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
  // A checkpoint is already the condensed form; stubbing it would hide the summary.
  const checkpoints = new Set(
    events.filter((event) => event.type === 'compaction/checkpoint').map((event) => event.seq),
  )
  const replacements: Array<CompactReplacement> = []
  let shadowedBytes = 0

  derived.forEach((entry, index) => {
    if (
      index >= boundary ||
      alreadyPruned.has(entry.seq) ||
      frame.has(entry.seq) ||
      checkpoints.has(entry.seq)
    ) {
      return
    }
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

/**
 * The messages a summary would stand for: everything outside the retention, in
 * order, without the system prompt (the request's frame, not history). Already
 * checkpointed or pruned messages are gone from the fold and never come back here.
 */
export function summarizableMessages(
  events: ReadonlyArray<SessionEvent>,
  options: CompactOptions,
): ReadonlyArray<DerivedMessage> {
  const derived = deriveMessagesWithSeqs(events)
  const boundary = Math.max(0, derived.length - options.keepLast)
  const frame = new Set(
    events.filter((event) => event.type === 'system/message').map((event) => event.seq),
  )
  return derived.slice(0, boundary).filter((entry) => !frame.has(entry.seq))
}

/** The range as the request would carry it: a recorded prune's replacements applied. */
export const messagesWithPrune = (
  messages: ReadonlyArray<DerivedMessage>,
  prune: CompactionPrune | undefined,
): ReadonlyArray<RequestMessage> =>
  (prune === undefined ? messages : applyReplacements(messages, prune.replacements)).map(
    (entry) => entry.message,
  )

const summaryMessage = (seq: SessionSeq, summary: string): DerivedMessage => ({
  seq,
  message: {
    role: 'user',
    content: [{ type: 'text', text: CHECKPOINT_PREAMBLE + summary }],
  },
})

/**
 * Replaces the summarized span with the one checkpoint message, where the span
 * began. A span an earlier checkpoint already replaced is left alone, so folding
 * the log twice cannot stack two summaries.
 */
const applyCheckpoint = (
  derived: ReadonlyArray<DerivedMessage>,
  event: SessionEvent & { readonly type: 'compaction/checkpoint' },
): ReadonlyArray<DerivedMessage> => {
  const shadowed = new Set(event.data.shadowedSeqs)
  if (!derived.some((entry) => shadowed.has(entry.seq))) return derived
  const kept: Array<DerivedMessage> = []
  let placed = false
  for (const entry of derived) {
    if (!shadowed.has(entry.seq)) {
      kept.push(entry)
      continue
    }
    if (!placed) {
      kept.push(summaryMessage(event.seq, event.data.summary))
      placed = true
    }
  }
  return kept
}

/** Rewrites the folded history so a recorded checkpoint stands for its span. */
export const checkpointProjection: MessageProjection = {
  type: 'compaction/checkpoint',
  name: 'compaction/checkpoint',
  project: (event, derived) =>
    event.type === 'compaction/checkpoint' ? applyCheckpoint(derived, event) : derived,
}

registerMessageProjection(checkpointProjection)

/** The instruction the auxiliary summarizer call answers with the checkpoint. */
export const COMPACT_SUMMARY_INSTRUCTION = [
  'You are now acting as a compaction engine for this coding assistant. Condense the',
  'conversation ABOVE into a structured checkpoint that lets another model resume the',
  'work without losing essential context.',
  '',
  'Output exactly this Markdown structure, keeping every section in order; write',
  '"(none)" for an empty section and never drop one:',
  '',
  '## Primary Request and Intent',
  '## Files and Code',
  '## Errors and Fixes',
  '## Pending Jobs',
  '## Current Work',
  '## Next Step',
  '## Critical Context',
  '',
  'Rules:',
  '- Preserve exact file paths, commands, error strings, identifiers, and numbers.',
  '- Do not mention this summarization request or that the context was compacted.',
  '- Answer with the checkpoint text only; call no tool and take no other action.',
].join('\n')

/** The event data one summarized range becomes. */
export const checkpointOf = (
  range: ReadonlyArray<DerivedMessage>,
  summary: string,
  model: { readonly provider: string; readonly model: string },
): CompactionCheckpoint | undefined => {
  const first = range[0]
  const last = range[range.length - 1]
  if (first === undefined || last === undefined || summary.trim() === '') return undefined
  return {
    shadowedSeqs: range.map((entry) => entry.seq),
    shadowedRange: { start: first.seq, end: last.seq },
    summary,
    provider: model.provider,
    model: model.model,
  }
}
