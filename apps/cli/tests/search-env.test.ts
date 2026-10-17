import { describe, expect, test } from 'vitest'
import { SEARCH_KEY_ENV, searchFromEnv } from '../src/index.ts'

describe('searchFromEnv', () => {
  test('no key means no provider', () => {
    expect(searchFromEnv({})).toBeUndefined()
    expect(searchFromEnv({ [SEARCH_KEY_ENV]: '' })).toBeUndefined()
  })

  test('a key gives a provider', () => {
    const host = searchFromEnv({ [SEARCH_KEY_ENV]: 'secret' })

    expect(host).toBeDefined()
    expect(typeof host?.search).toBe('function')
  })
})
