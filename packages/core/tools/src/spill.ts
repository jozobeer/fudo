import type { ContentBlock } from '@fudo/llm'

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
