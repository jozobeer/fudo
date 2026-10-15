import type { ContentBlock } from '@jozo-harness/llm'
import { Effect } from 'effect'
import type { ToolExecutionResult } from './types.ts'

export type SpillPlan =
  | { readonly kind: 'keep' }
  | {
      readonly kind: 'spill'
      /** The text that should be written next to the session. */
      readonly text: string
      /** What the model sees instead: the head of the text. */
      readonly preview: string
      readonly bytes: number
      readonly lines: number
    }

/** How many characters of a spilled result stay in the conversation. */
export const SPILL_PREVIEW_CHARS = 2000

/** Tools whose result is never written away: reading it again is the way back. */
const REREADABLE = new Set(['read'])

/** The plain text of a result: text blocks joined, other blocks ignored. */
export const textOf = (content: ReadonlyArray<ContentBlock>): string =>
  content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')

/**
 * Decides whether a result is too large to keep. Large results are written to
 * a file, and only their head stays in the conversation.
 */
export function planSpill(
  content: ReadonlyArray<ContentBlock>,
  maxBytes: number,
  previewChars = SPILL_PREVIEW_CHARS,
): SpillPlan {
  const text = textOf(content)
  const bytes = new TextEncoder().encode(text).length
  if (bytes <= maxBytes) return { kind: 'keep' }
  return {
    kind: 'spill',
    text,
    preview: text.slice(0, previewChars),
    bytes,
    lines: text.split('\n').length,
  }
}

/** How the pipeline writes a spilled result away; returns the reference to show. */
export type SpillWriter = (callId: string, text: string) => Effect.Effect<string>

/** Where a tool's complete result can be stored: the call it belongs to, and the store. */
export interface SpillTarget {
  readonly callId: string
  readonly spill?: SpillWriter
}

/**
 * Stores the complete text of a paged result next to the session and returns the
 * locator, or undefined when there is no store or it cannot write. A tool that
 * cannot store its overflow says how to narrow the search instead of failing.
 */
export const writeSpill = (
  target: SpillTarget,
  suffix: string,
  text: string,
): Effect.Effect<string | undefined> =>
  target.spill === undefined
    ? Effect.succeed(undefined)
    : target
        .spill(target.callId + '-' + suffix, text)
        .pipe(Effect.catchCause(() => Effect.succeed(undefined)))

/** The call a result belongs to, as much of it as the spill policy reads. */
export interface SpillSubject {
  readonly callId: string
  readonly tool: string
}

export interface SpillOptions {
  /** Results larger than this are written away. Unset means no spilling. */
  readonly maxSpillBytes?: number
  readonly spill?: SpillWriter
}

/** The notice that tells the model where the rest is and how to read it. */
const spillNotice = (path: string, plan: Extract<SpillPlan, { kind: 'spill' }>): string =>
  '[spilled to ' +
  path +
  ': ' +
  String(plan.lines) +
  ' lines, ' +
  String(plan.bytes) +
  ' bytes. Use the read tool with offset and limit to page through it.]\n'

/**
 * Replaces an oversized result with a reference and a preview. Errors are left
 * alone: the model needs to see what failed. Tools whose result can be read again
 * are left alone too, because spilling them would hide the way back. A store that
 * cannot write leaves the content inline rather than failing the call.
 */
export function applySpill(
  result: ToolExecutionResult,
  subject: SpillSubject,
  options: SpillOptions,
): Effect.Effect<ToolExecutionResult> {
  return Effect.gen(function* () {
    const maxBytes = options.maxSpillBytes
    const write = options.spill
    if (maxBytes === undefined || write === undefined || result.isError) return result
    if (REREADABLE.has(subject.tool)) return result
    const plan = planSpill(result.content, maxBytes)
    if (plan.kind === 'keep') return result
    const reference = yield* write(subject.callId, plan.text).pipe(
      Effect.catchCause(() => Effect.succeed(undefined)),
    )
    if (reference === undefined) return result
    return {
      ...result,
      content: [{ type: 'text', text: spillNotice(reference, plan) + plan.preview }],
    }
  })
}
