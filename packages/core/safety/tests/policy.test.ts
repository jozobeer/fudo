import { describe, expect, test } from 'vitest'
import { modeOf, widerModes } from '../src/index.ts'

describe('modeOf', () => {
  test('a preset names the sandbox mode its commands run under', () => {
    expect(modeOf('read-only')).toBe('read-only')
    expect(modeOf('workspace-write')).toBe('workspace-write')
    expect(modeOf('full')).toBe('danger-full-access')
  })
})

describe('widerModes', () => {
  test('only strictly wider modes may be asked for', () => {
    expect(widerModes('read-only')).toEqual(['workspace-write', 'danger-full-access'])
    expect(widerModes('workspace-write')).toEqual(['danger-full-access'])
    expect(widerModes('danger-full-access')).toEqual([])
  })
})
