import { describe, expect, test } from 'bun:test'
import { decide, type NeededCapability, type PermissionPreset } from '../src/index.ts'

describe('decide', () => {
  test('allows what the preset covers', () => {
    expect(decide('read-only', ['read'])).toEqual({ kind: 'allow' })
    expect(decide('workspace-write', ['read', 'write'])).toEqual({ kind: 'allow' })
    expect(decide('full', ['read', 'write', 'exec', 'network'])).toEqual({ kind: 'allow' })
  })

  test('asks to escalate what the preset lacks', () => {
    expect(decide('read-only', ['write'])).toEqual({
      kind: 'ask',
      reason: 'preset read-only does not allow: write',
    })
    expect(decide('workspace-write', ['exec']).kind).toBe('ask')
    expect(decide('workspace-write', ['exec', 'write'])).toEqual({
      kind: 'ask',
      reason: 'preset workspace-write does not allow: exec',
    })
  })

  test('denies unknown presets and unknown capabilities', () => {
    const bogus = 'teleport' as unknown as NeededCapability
    expect(decide('nope' as PermissionPreset, ['read'])).toEqual({
      kind: 'deny',
      reason: 'unknown preset: nope',
    })
    expect(decide('full', [bogus])).toEqual({
      kind: 'deny',
      reason: 'unknown capability: teleport',
    })
  })
})
