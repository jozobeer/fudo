import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { expandHome } from '../src/index.ts'

describe('expandHome', () => {
  test('turns a leading tilde into the home directory', () => {
    expect(expandHome('~/jozo-harness/sessions')).toBe(join(homedir(), 'jozo-harness/sessions'))
    expect(expandHome('~')).toBe(homedir())
  })

  test('leaves every other path alone', () => {
    expect(expandHome('/var/jozo-harness')).toBe('/var/jozo-harness')
    expect(expandHome('./sessions')).toBe('./sessions')
    expect(expandHome('~someone/else')).toBe('~someone/else')
  })
})
