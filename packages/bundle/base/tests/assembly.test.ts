import { describe, expect, test } from 'bun:test'
import { kernelPlugin, loadProfile, parseProfile } from '@fudo/kernel'
import { SystemPrompt, systemPromptPlugin } from '@fudo/system-prompt'
import { Tools, toolsPlugin } from '@fudo/tools'
import { Context, Effect, Layer } from 'effect'
import { loadBundledProfile } from '../src/index.ts'

describe('bundled profile assembly', () => {
  test('resolves the kernel, prompt, and tools rows into one layer', async () => {
    const profile = await Effect.runPromise(parseProfile(await loadBundledProfile()))
    const rows = profile.plugins.filter((row) =>
      ['kernel', 'system-prompt', 'tools'].includes(row.id),
    )

    const built = await Effect.runPromise(
      Effect.gen(function* () {
        const layer = yield* loadProfile({
          plugins: [kernelPlugin, systemPromptPlugin, toolsPlugin],
          layers: [rows],
        })
        const context = yield* Layer.build(layer)
        return {
          tools: Context.get(context, Tools).schemas(),
          sections: Context.get(context, SystemPrompt).sections(),
        }
      }).pipe(Effect.scoped),
    )

    expect(built.tools).toEqual([])
    expect(built.sections).toEqual([])
  })
})
