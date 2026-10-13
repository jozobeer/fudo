import { HooksLive } from '@fudo/kernel'
import { makeAsk } from '@fudo/safety'
import { Tools, toolsLayer, type ToolExecutionResult } from '@fudo/tools'
import { Deferred, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { askUserToolFor } from '../src/index.ts'

describe('ask_user tool', () => {
  test('waits for the answer and reports it', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ask = yield* makeAsk()
          const tools = yield* Tools
          yield* tools.register(askUserToolFor(ask))
          const done = yield* Deferred.make<ToolExecutionResult | undefined>()
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              const result = yield* tools.call({
                callId: 'c1',
                tool: 'ask_user',
                arguments: JSON.stringify({ question: 'which colour?', options: ['blue', 'red'] }),
                context: { sessionId: 's1', cwd: '/tmp', callId: 'c1' },
              })
              yield* Deferred.succeed(done, result)
            }),
          )
          yield* Effect.sleep('10 millis')
          const pending = ask.pending()
          yield* ask.answer('c1', 'blue')
          const result = yield* Deferred.await(done)
          return { pending, value: result?.value, isError: result?.isError }
        }).pipe(Effect.provide(Layer.provideMerge(toolsLayer, HooksLive))),
      ),
    )

    expect(observed.pending).toEqual(['c1'])
    expect(observed.isError).toBe(false)
    expect(observed.value).toEqual({ id: 'c1', question: 'which colour?', answer: 'blue' })
  })

  test('the answer is what the model sees', async () => {
    const content = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ask = yield* makeAsk()
          const tools = yield* Tools
          yield* tools.register(askUserToolFor(ask))
          const done = yield* Deferred.make<ToolExecutionResult | undefined>()
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              const result = yield* tools.call({
                callId: 'c2',
                tool: 'ask_user',
                arguments: JSON.stringify({ question: 'name?' }),
                context: { sessionId: 's1', cwd: '/tmp', callId: 'c2' },
              })
              yield* Deferred.succeed(done, result)
            }),
          )
          yield* Effect.sleep('10 millis')
          yield* ask.answer('c2', 'fudo')
          const result = yield* Deferred.await(done)
          return result?.content
        }).pipe(Effect.provide(Layer.provideMerge(toolsLayer, HooksLive))),
      ),
    )

    expect(content).toEqual([{ type: 'text', text: 'fudo' }])
  })
})
