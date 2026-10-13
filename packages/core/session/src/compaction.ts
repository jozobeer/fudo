import type { ContentBlock, RequestMessage } from '@fudo/llm'

export interface CompactOptions {
  /** Messages at the end that are never touched. */
  readonly keepLast: number
  /** Text blocks larger than this many bytes are replaced by a shorter form. */
  readonly maxBytes: number
}

export interface CompactResult {
  readonly messages: ReadonlyArray<RequestMessage>
  /** How many text blocks were shortened. */
  readonly shortened: number
}

const bytesOf = (text: string): number => new TextEncoder().encode(text).length

const keep = (text: string): ContentBlock => {
  const bytes = bytesOf(text)
  const head = text.slice(0, 120)
  return { type: 'text', text: '[earlier output of ' + String(bytes) + ' bytes] ' + head }
}

const compactBlocks = (
  content: ReadonlyArray<ContentBlock>,
  maxBytes: number,
): { readonly content: ReadonlyArray<ContentBlock>; readonly shortened: number } => {
  let shortened = 0
  const kept: Array<ContentBlock> = []
  for (const block of content) {
    if (block.type === 'reasoning') continue
    if (block.type === 'text' && bytesOf(block.text) > maxBytes) {
      kept.push(keep(block.text))
      shortened += 1
      continue
    }
    kept.push(block)
  }
  return { content: kept, shortened }
}

/**
 * Shortens the older part of a request: reasoning is dropped and oversized text
 * is replaced by a stub. The newest messages are never touched.
 */
export function compactMessages(
  messages: ReadonlyArray<RequestMessage>,
  options: CompactOptions,
): CompactResult {
  const boundary = Math.max(0, messages.length - options.keepLast)
  let shortened = 0
  const compacted = messages.map((message, index) => {
    if (index >= boundary) return message
    const result = compactBlocks(message.content, options.maxBytes)
    shortened += result.shortened
    return { ...message, content: result.content }
  })
  return { messages: compacted, shortened }
}
