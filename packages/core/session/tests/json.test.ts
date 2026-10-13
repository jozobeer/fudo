import { describe, expect, test } from 'bun:test'
import { isJsonValue } from '../src/index.ts'

describe('isJsonValue', () => {
  test('accepts nested lossless JSON', () => {
    expect(isJsonValue({ nested: [1, 'two', null, true, { deep: 0.5 }] })).toBe(true)
  })

  test('accepts runtime-generated payloads', () => {
    const value = {
      id: crypto.randomUUID(),
      list: [Math.random(), { n: Math.floor(Math.random() * 1000) }],
    }
    expect(isJsonValue(value)).toBe(true)
  })

  test('accepts a null-prototype object', () => {
    const value = Object.create(null) as Record<string, unknown>
    value.ok = true
    expect(isJsonValue(value)).toBe(true)
  })

  test.each([
    ['undefined', undefined],
    ['function', () => 1],
    ['symbol', Symbol('x')],
    ['bigint', 1n],
    ['date', new Date()],
    ['map', new Map()],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined property', { missing: undefined }],
    ['undefined member', [undefined]],
  ])('rejects %s', (_name, value) => {
    expect(isJsonValue(value)).toBe(false)
  })

  test('rejects a cycle', () => {
    const value: Record<string, unknown> = {}
    value.self = value
    expect(isJsonValue(value)).toBe(false)
  })
})
