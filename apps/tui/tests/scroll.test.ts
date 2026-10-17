import { describe, expect, test } from 'vitest'
import {
  TAIL,
  linesBelow,
  pageBack,
  pageForward,
  scrollKey,
  windowTop,
  type Scroll,
  type Viewport,
} from '../src/index.ts'

const view = (lines: number, height = 5): Viewport => ({ lines, height })
const back = (scroll: Scroll, value: Viewport): number => windowTop(scroll, value)

describe('tui scroll', () => {
  test('the tail is the last page', () => {
    expect(back(TAIL, view(20))).toBe(15)
    expect(linesBelow(TAIL, view(20))).toBe(0)
  })

  test('content that fits has nowhere to scroll', () => {
    expect(back(TAIL, view(3))).toBe(0)
    expect(pageBack(TAIL, view(3))).toEqual(TAIL)
    expect(linesBelow(TAIL, view(3))).toBe(0)
  })

  test('a pinned window keeps its line while output arrives', () => {
    const pinned = pageBack(TAIL, view(20))
    expect(back(pinned, view(20))).toBe(10)
    expect(back(pinned, view(30))).toBe(10)
    expect(linesBelow(pinned, view(30))).toBe(15)
  })

  test('a pinned line outside the content is pulled onto it', () => {
    expect(back({ kind: 'pinned', top: 99 }, view(20))).toBe(15)
    expect(back({ kind: 'pinned', top: -5 }, view(20))).toBe(0)
  })

  test('paging forward from the last page follows the tail again', () => {
    expect(pageForward(pageBack(TAIL, view(20)), view(20))).toEqual(TAIL)
    expect(pageForward(TAIL, view(20))).toEqual(TAIL)
  })

  test('paging back stops at the first line', () => {
    let scroll: Scroll = TAIL
    for (let step = 0; step < 10; step += 1) scroll = pageBack(scroll, view(20))
    expect(back(scroll, view(20))).toBe(0)
    expect(linesBelow(scroll, view(20))).toBe(15)
  })

  test('a wheel notch moves the window a few lines and the ends hold', () => {
    const up = scrollKey(TAIL, { kind: 'wheelUp' }, view(20))
    expect(up).toEqual({ kind: 'pinned', top: 12 })
    expect(scrollKey(up ?? TAIL, { kind: 'wheelDown' }, view(20))).toEqual(TAIL)
    expect(scrollKey(TAIL, { kind: 'wheelDown' }, view(20))).toEqual(TAIL)
    expect(scrollKey({ kind: 'pinned', top: 0 }, { kind: 'wheelUp' }, view(20))).toEqual({
      kind: 'pinned',
      top: 0,
    })
    // Content that fits has nowhere to go, whatever the wheel asks for.
    expect(scrollKey(TAIL, { kind: 'wheelUp' }, view(3))).toEqual(TAIL)
  })

  test('page up and page down move the window, escape returns to the tail', () => {
    const up = scrollKey(TAIL, { kind: 'pageUp' }, view(20))
    expect(up).toEqual({ kind: 'pinned', top: 10 })
    expect(scrollKey(up ?? TAIL, { kind: 'pageDown' }, view(20))).toEqual(TAIL)
    expect(scrollKey(up ?? TAIL, { kind: 'escape' }, view(20))).toEqual(TAIL)
    expect(scrollKey(TAIL, { kind: 'escape' }, view(20))).toBeUndefined()
    expect(scrollKey(TAIL, { kind: 'char', char: 'a' }, view(20))).toBeUndefined()
  })
})
