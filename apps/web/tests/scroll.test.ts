import { describe, expect, test } from 'vitest'
import { FOLLOW_SLACK, followsBottom } from '../src/ui/scroll.ts'

/** A scroll box where the content overflows by exactly `below` pixels. */
const box = (below: number) => ({ scrollTop: 600 - below, clientHeight: 400, scrollHeight: 1000 })

describe('the browser scroll follow', () => {
  test('follows while the reader is at the bottom', () => {
    expect(followsBottom(box(0))).toBe(true)
    expect(followsBottom(box(FOLLOW_SLACK))).toBe(true)
  })

  test('lets go once the reader is above the fold', () => {
    expect(followsBottom(box(FOLLOW_SLACK + 1))).toBe(false)
    expect(followsBottom(box(600))).toBe(false)
  })

  test('follows when the conversation is shorter than the box', () => {
    expect(followsBottom({ scrollTop: 0, clientHeight: 400, scrollHeight: 120 })).toBe(true)
  })
})
