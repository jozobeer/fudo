import { describe, expect, test } from 'bun:test'
import { nextDue, parseCron } from '../src/index.ts'

/** A local instant, so the tests speak in the same clock the schedules do. */
const at = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): number => new Date(year, month - 1, day, hour, minute, second, 0).getTime()

const local = (ms: number | undefined): string => {
  if (ms === undefined) return 'never'
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    String(date.getFullYear()) +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes()) +
    ':' +
    pad(date.getSeconds())
  )
}

describe('every', () => {
  test('comes around again after the interval', () => {
    const from = at(2026, 10, 14, 9, 0, 0)

    expect(nextDue({ kind: 'every', seconds: 90 }, from, undefined)).toBe(from + 90_000)
  })

  test('counts from the last firing, not from the clock', () => {
    const from = at(2026, 10, 14, 9, 0, 0)
    const fired = at(2026, 10, 14, 9, 0, 30)

    expect(nextDue({ kind: 'every', seconds: 60 }, from, fired)).toBe(fired + 60_000)
  })
})

describe('daily', () => {
  test('is the next time that clock reading comes around', () => {
    const from = at(2026, 10, 14, 9, 0, 0)

    expect(local(nextDue({ kind: 'daily', time: '18:30' }, from, undefined))).toBe(
      '2026-10-14 18:30:00',
    )
    expect(local(nextDue({ kind: 'daily', time: '08:00' }, from, undefined))).toBe(
      '2026-10-15 08:00:00',
    )
  })

  test('a time that has just passed waits for tomorrow', () => {
    const from = at(2026, 10, 14, 18, 30, 0)

    expect(local(nextDue({ kind: 'daily', time: '18:30' }, from, undefined))).toBe(
      '2026-10-15 18:30:00',
    )
  })
})

describe('weekly', () => {
  test('lands on the next named weekday', () => {
    // 2026-10-14 is a Wednesday.
    const from = at(2026, 10, 14, 9, 0, 0)

    expect(local(nextDue({ kind: 'weekly', weekdays: [1], time: '07:00' }, from, undefined))).toBe(
      '2026-10-19 07:00:00',
    )
    // The same weekday, later today, is still ahead.
    expect(local(nextDue({ kind: 'weekly', weekdays: [3], time: '10:00' }, from, undefined))).toBe(
      '2026-10-14 10:00:00',
    )
    expect(local(nextDue({ kind: 'weekly', weekdays: [3], time: '08:00' }, from, undefined))).toBe(
      '2026-10-21 08:00:00',
    )
  })
})

describe('cron', () => {
  test('every minute', () => {
    const from = at(2026, 10, 14, 9, 0, 30)

    expect(local(nextDue({ kind: 'cron', expression: '* * * * *' }, from, undefined))).toBe(
      '2026-10-14 09:01:00',
    )
  })

  test('a fixed time, a step, and a list', () => {
    const from = at(2026, 10, 14, 9, 0, 0)

    expect(local(nextDue({ kind: 'cron', expression: '30 18 * * *' }, from, undefined))).toBe(
      '2026-10-14 18:30:00',
    )
    expect(local(nextDue({ kind: 'cron', expression: '*/15 * * * *' }, from, undefined))).toBe(
      '2026-10-14 09:15:00',
    )
    expect(local(nextDue({ kind: 'cron', expression: '0 9,17 * * *' }, from, undefined))).toBe(
      '2026-10-14 17:00:00',
    )
  })

  test('ranges, weekdays, and month days', () => {
    const from = at(2026, 10, 14, 9, 0, 0)

    expect(local(nextDue({ kind: 'cron', expression: '0 9-11 * * 1-5' }, from, undefined))).toBe(
      '2026-10-14 10:00:00',
    )
    // Day 20 of this month, at the top of the day.
    expect(local(nextDue({ kind: 'cron', expression: '0 0 20 * *' }, from, undefined))).toBe(
      '2026-10-20 00:00:00',
    )
  })

  test('a weekday field is the weekday field', () => {
    // 2026-10-14 is a Wednesday, so the next Sunday is the 18th.
    const from = at(2026, 10, 14, 9, 0, 0)

    expect(local(nextDue({ kind: 'cron', expression: '0 0 * * 0' }, from, undefined))).toBe(
      '2026-10-18 00:00:00',
    )
    expect(local(nextDue({ kind: 'cron', expression: '0 0 * * 3' }, from, undefined))).toBe(
      '2026-10-21 00:00:00',
    )
  })

  test('a field that cannot happen is refused', () => {
    expect(() => parseCron('61 * * * *')).toThrow()
    expect(() => parseCron('* * * *')).toThrow()
    expect(() => parseCron('* * * * * *')).toThrow()
    expect(() => parseCron('* * 32 * *')).toThrow()
  })
})
