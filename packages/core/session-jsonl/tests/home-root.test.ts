import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { expandHome } from '../src/index.ts'

describe('expandHome', () => {
  test('turns a leading tilde into the home directory', () => {
    expect(expandHome('~/fudo/sessions')).toBe(join(homedir(), 'fudo/sessions'))
    expect(expandHome('~')).toBe(homedir())
  })

  test('leaves every other path alone', () => {
    expect(expandHome('/var/fudo')).toBe('/var/fudo')
    expect(expandHome('./sessions')).toBe('./sessions')
    expect(expandHome('~someone/else')).toBe('~someone/else')
  })
})
