import { describe, expect, test } from 'vitest'
import { displayWidth, wrapText } from '../src/index.ts'

describe('display width and wrapping', () => {
  test('east asian wide characters count as two cells', () => {
    expect(displayWidth('abc')).toBe(3)
    expect(displayWidth('あいう')).toBe(6)
    expect(displayWidth('aあ')).toBe(3)
  })

  test('wraps at the width, keeping every character', () => {
    expect(wrapText('abcdef', 3)).toEqual(['abc', 'def'])
  })

  test('a wide character that does not fit starts the next line', () => {
    expect(wrapText('aあb', 2)).toEqual(['a', 'あ', 'b'])
  })

  test('newlines split first, and an empty line stays a line', () => {
    expect(wrapText('a\nb', 5)).toEqual(['a', 'b'])
    expect(wrapText('a\n\nb', 5)).toEqual(['a', '', 'b'])
  })
})
