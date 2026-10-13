import { type FinishKind, type LlmUsage, type StreamChunk } from '@fudo/llm'

interface OpenAiToolCallDelta {
  readonly index?: number
  readonly id?: string
  readonly function?: { readonly name?: string; readonly arguments?: string }
}

interface OpenAiDelta {
  readonly content?: string | null
  readonly reasoning?: string | null
  readonly tool_calls?: ReadonlyArray<OpenAiToolCallDelta>
}

interface OpenAiUsage {
  readonly prompt_tokens?: number
  readonly completion_tokens?: number
  readonly completion_tokens_details?: { readonly reasoning_tokens?: number }
}

interface OpenAiChunk {
  readonly choices?: ReadonlyArray<{
    readonly delta?: OpenAiDelta
    readonly finish_reason?: string | null
  }>
  readonly usage?: OpenAiUsage | null
}

const REASONING_INDEX = 0
const TEXT_INDEX = 1
const TOOL_INDEX_BASE = 2

const finishKindOf = (reason: string | null | undefined): FinishKind => {
  switch (reason) {
    case 'stop':
      return 'stop'
    case 'tool_calls':
      return 'tool-calls'
    case 'length':
      return 'length'
    default:
      return 'error'
  }
}

const toUsage = (usage: OpenAiUsage | null | undefined): LlmUsage | undefined => {
  if (usage === undefined || usage === null) return undefined
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  }
}

/**
 * Decodes the OpenAI-compatible SSE stream into the fudo chunk vocabulary.
 *
 * OpenRouter-style providers put `usage` in a chunk with `choices: []` that
 * arrives *after* `finish_reason`, so this decoder holds the finish chunk back
 * and emits it after usage. Tool calls may arrive complete and several at a
 * time, so each entry becomes its own `tool-call-delta`.
 */
export class OpenAiStreamDecoder {
  private openBlock: 'reasoning' | 'text' | undefined = undefined
  private pendingFinish: FinishKind | undefined = undefined

  push(line: string): ReadonlyArray<StreamChunk> {
    if (!line.startsWith('data:')) return []
    const payload = line.slice('data:'.length).trim()
    if (payload === '[DONE]') {
      const finish = this.pendingFinish
      this.pendingFinish = undefined
      return finish === undefined ? [] : [{ type: 'finish', kind: finish }]
    }

    let parsed: OpenAiChunk
    try {
      parsed = JSON.parse(payload) as OpenAiChunk
    } catch {
      return []
    }

    const chunks: Array<StreamChunk> = []
    const usage = toUsage(parsed.usage)
    if (usage !== undefined) {
      chunks.push({ type: 'usage', usage })
      if (this.pendingFinish !== undefined) {
        chunks.push({ type: 'finish', kind: this.pendingFinish })
        this.pendingFinish = undefined
      }
    }

    const choice = parsed.choices?.[0]
    const delta = choice?.delta
    if (delta !== undefined) {
      const reasoning = delta.reasoning
      if (typeof reasoning === 'string' && reasoning !== '') {
        if (this.openBlock !== 'reasoning') {
          chunks.push({ type: 'block-start', index: REASONING_INDEX, blockType: 'reasoning' })
          this.openBlock = 'reasoning'
        }
        chunks.push({ type: 'reasoning-delta', index: REASONING_INDEX, text: reasoning })
      }
      const text = delta.content
      if (typeof text === 'string' && text !== '') {
        if (this.openBlock !== 'text') {
          chunks.push({ type: 'block-start', index: TEXT_INDEX, blockType: 'text' })
          this.openBlock = 'text'
        }
        chunks.push({ type: 'text-delta', index: TEXT_INDEX, text })
      }
      for (const call of delta.tool_calls ?? []) {
        this.openBlock = undefined
        chunks.push({
          type: 'tool-call-delta',
          index: TOOL_INDEX_BASE + (call.index ?? 0),
          id: call.id ?? '',
          ...(call.function?.name === undefined ? {} : { name: call.function.name }),
          argumentsDelta: call.function?.arguments ?? '',
        })
      }
    }

    const reason = choice?.finish_reason
    if (reason !== undefined && reason !== null) {
      if (usage !== undefined) chunks.push({ type: 'finish', kind: finishKindOf(reason) })
      else this.pendingFinish = finishKindOf(reason)
    }

    return chunks
  }
}

/** Decodes a complete recorded stream. The adapter uses the decoder incrementally. */
export function decodeOpenAiStream(lines: ReadonlyArray<string>): ReadonlyArray<StreamChunk> {
  const decoder = new OpenAiStreamDecoder()
  const chunks: Array<StreamChunk> = []
  for (const line of lines) chunks.push(...decoder.push(line))
  chunks.push(...decoder.push('data: [DONE]'))
  return chunks
}
