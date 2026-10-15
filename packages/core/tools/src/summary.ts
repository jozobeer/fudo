import type { ContentBlock } from '@jozo-harness/llm'

/** How much of a call's arguments a one-line summary keeps. */
export const CALL_SUMMARY_CHARS = 80
/** How much of a result a one-line summary keeps. */
export const RESULT_SUMMARY_CHARS = 200

/** The first line of a text, with runs of whitespace flattened. */
export const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat
}

/** What a call looks like when its tool has no presenter of its own. */
export const callSummary = (tool: string, argumentsJson: string): string => {
  const shown = oneLine(argumentsJson).slice(0, CALL_SUMMARY_CHARS)
  return shown === '' ? tool : shown
}

/** What a result looks like when its tool has no presenter of its own. */
export const resultSummary = (
  content: ReadonlyArray<ContentBlock>,
  limit: number = RESULT_SUMMARY_CHARS,
): string =>
  oneLine(content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(' ')).slice(
    0,
    limit,
  )
