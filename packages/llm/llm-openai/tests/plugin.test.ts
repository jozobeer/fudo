import { describe, expect, test } from 'bun:test'
import { kernelPlugin, loadProfile } from '@fudo/kernel'
import { Llm } from '@fudo/llm'
import { llmOpenAiPlugin } from '@fudo/llm-openai'
import { Context, Effect, Layer } from 'effect'

describe('llmOpenAiPlugin', () => {
  test('builds an adapter from its profile config', async () => {
    const adapter = await Effect.runPromise(
      Effect.gen(function* () {
        const layer = yield* loadProfile({
          plugins: [kernelPlugin, llmOpenAiPlugin],
          layers: [
            [
              { id: 'kernel', name: '@fudo/kernel', config: {} },
              {
                id: 'llm',
                name: '@fudo/llm-openai',
                config: {
                  baseUrl: 'https://ollama.com/v1',
                  apiKeyEnv: 'OLLAMA_API_KEY',
                  streamIdleTimeoutMs: 1000,
                },
              },
            ],
          ],
        })
        const context = yield* Layer.build(layer)
        return Context.get(context, Llm)
      }).pipe(Effect.scoped),
    )

    expect(adapter.name).toBe('openai')
    expect(adapter.capabilities.toolChoice).toBe(false)
  })

  test('rejects a config that is missing baseUrl', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        loadProfile({
          plugins: [kernelPlugin, llmOpenAiPlugin],
          layers: [[{ id: 'llm', name: '@fudo/llm-openai', config: { apiKeyEnv: 'K' } }]],
        }),
      ),
    )

    expect(error.code).toBe('config')
  })
})
