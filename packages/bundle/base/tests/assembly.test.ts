import { describe, expect, test } from 'bun:test'
import { kernelPlugin, loadProfile, parseProfile } from '@fudo/kernel'
import { Sessions, sessionPlugin } from '@fudo/session'
import { sessionJsonlPlugin } from '@fudo/session-jsonl'
import { SystemPrompt, systemPromptPlugin } from '@fudo/system-prompt'
import { Tools, toolsPlugin } from '@fudo/tools'
import { Context, Effect, Layer } from 'effect'
import { loadBundledProfile } from '../src/index.ts'

describe('bundled profile assembly', () => {
  test('resolves the five S1 rows into one layer', async () => {
    const profile = await Effect.runPromise(parseProfile(await loadBundledProfile()))
    const wanted = new Set(['kernel', 'sessions', 'session-jsonl', 'system-prompt', 'tools'])
    const rows = profile.plugins.filter((row) => wanted.has(row.id))

    const built = await Effect.runPromise(
      Effect.gen(function* () {
        const layer = yield* loadProfile({
          plugins: [
            kernelPlugin,
            sessionJsonlPlugin,
            sessionPlugin,
            systemPromptPlugin,
            toolsPlugin,
          ],
          layers: [rows],
        })
        const context = yield* Layer.build(layer)
        return {
          tools: typeof Context.get(context, Tools).schemas,
          sections: typeof Context.get(context, SystemPrompt).sections,
          sessions: typeof Context.get(context, Sessions).create,
        }
      })
        .pipe(Effect.scoped)
        .pipe(
          Effect.match({
            onFailure: (error: unknown) => ({ failed: String(error).slice(0, 160) }),
            onSuccess: (value) => value,
          }),
        ),
    )

    expect(built).toMatchObject({ tools: 'function', sections: 'function', sessions: 'function' })
  })
})
