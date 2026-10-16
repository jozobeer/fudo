import { describe, expect, test } from 'bun:test'
import { KeyDecoder } from '../src/index.ts'

const decode = (text: string) => new KeyDecoder().push(text)

describe('key decoder', () => {
  test('decodes printable input one character at a time', () => {
    expect(decode('ab')).toEqual([
      { kind: 'char', char: 'a' },
      { kind: 'char', char: 'b' },
    ])
  })

  test('decodes control keys', () => {
    expect(decode('\r')).toEqual([{ kind: 'enter' }])
    expect(decode('\u007f')).toEqual([{ kind: 'backspace' }])
    expect(decode('\t')).toEqual([{ kind: 'tab' }])
    expect(decode('\u0003')).toEqual([{ kind: 'ctrl', char: 'c' }])
  })

  test('decodes arrows, home, end and delete', () => {
    expect(decode('\u001b[A\u001b[B\u001b[C\u001b[D')).toEqual([
      { kind: 'up' },
      { kind: 'down' },
      { kind: 'right' },
      { kind: 'left' },
    ])
    expect(decode('\u001b[H\u001b[F\u001b[3~')).toEqual([
      { kind: 'home' },
      { kind: 'end' },
      { kind: 'delete' },
    ])
  })

  test('holds an incomplete sequence until the rest arrives', () => {
    const decoder = new KeyDecoder()
    expect(decoder.push('\u001b[')).toEqual([])
    expect(decoder.push('A')).toEqual([{ kind: 'up' }])
  })

  test('turns a pasted block into characters, newlines become spaces', () => {
    expect(decode('\u001b[200~a\nb\u001b[201~')).toEqual([
      { kind: 'char', char: 'a' },
      { kind: 'char', char: ' ' },
      { kind: 'char', char: 'b' },
    ])
  })

  test('decodes page up and page down', () => {
    expect(decode('\u001b[5~\u001b[6~')).toEqual([{ kind: 'pageUp' }, { kind: 'pageDown' }])
  })

  test('non-ascii input survives', () => {
    expect(decode('あ')).toEqual([{ kind: 'char', char: 'あ' }])
  })

  test('decodes a wheel notch from an SGR mouse report', () => {
    expect(decode('\u001b[<64;10;5M\u001b[<65;10;5M')).toEqual([
      { kind: 'wheelUp' },
      { kind: 'wheelDown' },
    ])
  })

  test('a wheel notch with a modifier held is still a wheel notch', () => {
    // Above the two button bits sit shift, alt and ctrl; they do not change the scroll.
    expect(decode('\u001b[<68;3;1M')).toEqual([{ kind: 'wheelUp' }])
    expect(decode('\u001b[<73;3;1M')).toEqual([{ kind: 'wheelDown' }])
  })

  test('a horizontal wheel notch and a click are consumed without a key', () => {
    expect(decode('\u001b[<66;10;5M\u001b[<67;10;5M\u001b[<0;10;5M\u001b[<0;10;5ma')).toEqual([
      { kind: 'char', char: 'a' },
    ])
  })

  test('holds a mouse report until the rest of it arrives', () => {
    const decoder = new KeyDecoder()
    expect(decoder.push('\u001b[<64;10')).toEqual([])
    expect(decoder.push(';5M')).toEqual([{ kind: 'wheelUp' }])
  })

  test('holds a lone escape until the reader says nothing follows it', () => {
    const decoder = new KeyDecoder()
    expect(decoder.push('\u001b')).toEqual([])
    expect(decoder.holdingEscape).toBe(true)
    expect(decoder.flush()).toEqual([{ kind: 'escape' }])
    expect(decoder.holdingEscape).toBe(false)
  })
})
