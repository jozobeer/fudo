import { describe, expect, test } from 'vitest'
import { parseProfile } from '@jozo-harness/kernel'
import { Effect } from 'effect'
import { loadBundledProfileNamed } from '../src/index.ts'

describe('bundled profiles', () => {
  test('headless and repl parse and name themselves', async () => {
    for (const name of ['headless', 'repl']) {
      const parsed = await Effect.runPromise(parseProfile(await loadBundledProfileNamed(name)))
      expect(parsed.name).toBe(name)
      expect(parsed.plugins).toEqual([])
    }
  })

  test('base parses and carries the plugin rows', async () => {
    const parsed = await Effect.runPromise(parseProfile(await loadBundledProfileNamed('base')))

    expect(parsed.name).toBe('base')
    expect(parsed.plugins.length).toBeGreaterThan(0)
  })

  test('an unknown profile fails to load', async () => {
    for (const name of ['nope', 'constructor', '../base']) {
      await expect(loadBundledProfileNamed(name)).rejects.toThrow(name)
    }
  })
})
