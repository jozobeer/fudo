import { describe, expect, test } from 'vitest'
import { firstLine, oneLine, plainText, truncate } from '../src/index.ts'

describe('text', () => {
  test('terminal control sequences and control bytes are stripped', () => {
    expect(plainText('\u001b[31mred\u001b[0m')).toBe('red')
    expect(plainText('a\u0007b\u001bc\u007fd')).toBe('abcd')
    expect(plainText('\u001b]0;title\u0007kept')).toBe('kept')
  })

  test('tabs and newlines survive; other C0 bytes do not', () => {
    expect(plainText('a\tb\nc')).toBe('a\tb\nc')
  })

  test('firstLine and oneLine collapse what a summary needs', () => {
    expect(firstLine('one\ntwo')).toBe('one')
    expect(oneLine('  a\n  b ')).toBe('a b')
  })

  test('truncate marks the cut and keeps short text intact', () => {
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('abcdef', 4)).toBe('abc…')
  })
})
