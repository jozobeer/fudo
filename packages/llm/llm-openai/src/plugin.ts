import { Llm } from '@jozo-harness/llm'
import type { Plugin } from '@jozo-harness/kernel'
import { Layer, Schema } from 'effect'
import { openAiAdapter } from './adapter.ts'

/** Settings of the OpenAI-compatible provider. */
export const llmOpenAiConfig = Schema.Struct({
  baseUrl: Schema.String,
  /** Name of the environment variable that holds the key. */
  apiKeyEnv: Schema.String,
  /** Idle budget for one provider attempt, in milliseconds. */
  streamIdleTimeoutMs: Schema.optionalKey(Schema.Int),
  /** The routed model's context window in tokens, for compaction pressure. */
  contextWindow: Schema.optionalKey(Schema.Int),
})

/**
 * Loader definition for the Ollama Cloud adapter. The capability set is the
 * one the recording confirmed: no `tool_choice`, no prompt cache control.
 */
export const llmOpenAiPlugin: Plugin<typeof llmOpenAiConfig.Type, Llm, never> = {
  name: '@jozo-harness/llm-openai',
  config: llmOpenAiConfig,
  provides: [Llm],
  requires: [],
  layer: (config) =>
    Layer.succeed(
      Llm,
      openAiAdapter({
        baseUrl: config.baseUrl,
        apiKey: () => process.env[config.apiKeyEnv],
        capabilities: {
          toolChoice: false,
          reasoningEffort: null,
          images: 'none',
          promptCacheControl: false,
          ...(config.contextWindow === undefined ? {} : { contextWindow: config.contextWindow }),
        },
        ...(config.streamIdleTimeoutMs === undefined
          ? {}
          : { streamIdleTimeoutMs: config.streamIdleTimeoutMs }),
      }),
    ),
}
