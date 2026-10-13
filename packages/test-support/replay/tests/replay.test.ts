import { describe, expect, test } from 'bun:test'
import { kernelPlugin, loadProfile } from '@fudo/kernel'
import { BlockAssembler, Llm } from '@fudo/llm'
import { Context, Effect, Layer, Stream } from 'effect'
import { replayAdapter, replayPlugin } from '../src/index.ts'

const recording = async (): Promise<string> =>
  Bun.file(
    new URL('../../../llm/llm-openai/fixtures/ollama-cloud-tool-call.sse', import.meta.url),
  ).text()

describe('replayAdapter', () => {
  test('replays the recorded stream as assistant content', async () => {
    const adapter = replayAdapter(await recording())
    const assembler = new BlockAssembler()
    const chunks = await Effect.runPromise(
      Stream.runCollect(
        adapter.stream({
          provider: 'ollama-cloud',
          model: 'kimi-k2.7-code',
          messages: [],
          tools: undefined,
          params: {},
        }),
      ),
    )

    for (const chunk of chunks) assembler.push(chunk)
    const assembled = assembler.snapshot()
    const calls = assembled.content.flatMap((block) =>
      block.type === 'tool-call' ? [block.name] : [],
    )

    expect(assembled.content.some((block) => block.type === 'reasoning')).toBe(true)
    expect(calls).toEqual(['echo', 'count'])
    expect(assembled.finish).toBe('tool-calls')
  })

  test('serves Llm through the loader', async () => {
    const sse = await recording()
    const adapter = await Effect.runPromise(
      Effect.gen(function* () {
        const layer = yield* loadProfile({
          plugins: [kernelPlugin, replayPlugin(sse)],
          layers: [
            [
              { id: 'kernel', name: '@fudo/kernel', config: {} },
              { id: 'llm', name: 'replay-llm', config: {} },
            ],
          ],
        })
        const context = yield* Layer.build(layer)
        return Context.get(context, Llm)
      }).pipe(Effect.scoped),
    )

    expect(adapter.name).toBe('replay')
  })
})
