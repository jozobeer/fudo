import type { Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { OpenAiStreamDecoder } from '@fudo/llm-openai'
import { Layer, Schema, Stream } from 'effect'

/**
 * Turns a recorded OpenAI-compatible SSE transcript into an adapter. Tests and
 * demos replay a real stream through the real registry, pipeline, and log.
 */
export function replayAdapter(sse: string, name = 'replay'): LlmAdapter {
  const decoder = new OpenAiStreamDecoder()
  const chunks: Array<StreamChunk> = []
  for (const line of sse.split('\n')) chunks.push(...decoder.push(line))
  chunks.push(...decoder.push('data: [DONE]'))
  return {
    name,
    capabilities: {
      toolChoice: false,
      reasoningEffort: null,
      images: 'none',
      promptCacheControl: false,
    },
    stream: () => Stream.fromIterable(chunks),
  }
}

/** A loader plugin that provides `Llm` from one recording. */
export function replayPlugin(sse: string): Plugin<{}, Llm, never> {
  return {
    name: 'replay-llm',
    config: Schema.Struct({}),
    provides: [Llm],
    requires: [],
    layer: () => Layer.succeed(Llm, replayAdapter(sse)),
  }
}
