import { describe, expect, test } from 'bun:test'
import { loadBundledProfile } from '@fudo/bundle-base'
import { parseProfile } from '@fudo/kernel'
import { Effect } from 'effect'
import { bundledPlugins } from '../src/plugins.ts'

const names = (): ReadonlyArray<string> => bundledPlugins.map((plugin) => plugin.name)

describe('the plugins the command can assemble', () => {
  test('has every plugin the bundled profile names', async () => {
    const text = await loadBundledProfile()
    const profile = await Effect.runPromise(parseProfile(text))

    for (const row of profile.plugins) expect(names()).toContain(row.name)
  })

  test('has the mcp plugin, so a settings row can name it', () => {
    expect(names()).toContain('@fudo/mcp')
  })
})
