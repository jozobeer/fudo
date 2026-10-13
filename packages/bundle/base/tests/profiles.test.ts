import { describe, expect, test } from 'bun:test'
import { parseProfile } from '@fudo/kernel'
import { Effect } from 'effect'
import { bundledProfileUrl, loadBundledProfileNamed } from '../src/index.ts'

describe('bundled profiles', () => {
  test('headless and repl parse and name themselves', async () => {
    for (const name of ['headless', 'repl']) {
      const parsed = await Effect.runPromise(parseProfile(await loadBundledProfileNamed(name)))
      expect(parsed.name).toBe(name)
      expect(parsed.plugins).toEqual([])
    }
  })

  test('an unknown profile fails to load', async () => {
    let failed = false
    try {
      await loadBundledProfileNamed('nope')
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
    expect(bundledProfileUrl('nope').pathname.endsWith('/profiles/nope.yml')).toBe(true)
  })
})
