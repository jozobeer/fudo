/**
 * When a schedule comes around next. Everything here is a pure function of a rule,
 * a reference instant, and the last firing, on the process's own local clock.
 */

/** How a schedule repeats. */
export type ScheduleRule =
  | { readonly kind: 'every'; readonly seconds: number }
  | { readonly kind: 'daily'; readonly time: string }
  | { readonly kind: 'weekly'; readonly weekdays: ReadonlyArray<number>; readonly time: string }
  | { readonly kind: 'cron'; readonly expression: string }

/** The days a four-year search looks through before it gives a rule up for dead. */
const MAX_DAYS = 1462

const MINUTES_PER_DAY = 1440

/** Which minutes, hours, month days, months, and weekdays a cron rule accepts. */
export interface CronFields {
  readonly minutes: ReadonlySet<number>
  readonly hours: ReadonlySet<number>
  readonly monthDays: ReadonlySet<number>
  readonly months: ReadonlySet<number>
  /** JavaScript weekdays, 0 = Sunday. */
  readonly weekdays: ReadonlySet<number>
}

const FIELD_RANGES: ReadonlyArray<readonly [name: string, min: number, max: number]> = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['day of month', 1, 31],
  ['month', 1, 12],
  ['day of week', 0, 7],
]

/** One comma-separated part of a cron field: `*`, `a`, `a-b`, or either with `/n`. */
/** The first and last value one `*` or `a-b` part names. */
const boundsOf = (
  range: string,
  min: number,
  max: number,
  name: string,
): readonly [number, number] => {
  if (range === '*') return [min, max]
  const values = range.split('-').map((value) => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new Error('bad ' + name + ' in a cron expression: ' + value)
    }
    return parsed
  })
  const first = values[0] ?? min
  const last = values.length === 1 ? first : (values[1] ?? max)
  if (last < first) throw new Error('backwards range in the ' + name + ' field')
  return [first, last]
}

/** Every value one comma-separated part of a cron field names. */
const numbersIn = (part: string, min: number, max: number, name: string): ReadonlyArray<number> => {
  const [range, stepText] = part.split('/')
  if (range === undefined) throw new Error('empty ' + name + ' in a cron expression')
  const step = stepText === undefined ? 1 : Number(stepText)
  if (!Number.isInteger(step) || step < 1) throw new Error('bad step in the ' + name + ' field')
  const [first, last] = boundsOf(range, min, max, name)
  const values: Array<number> = []
  for (let value = first; value <= last; value += step) values.push(value)
  return values
}

/** Parses one 5-field cron expression; a field that cannot happen is refused here. */
export const parseCron = (expression: string): CronFields => {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error('a cron expression has five fields: ' + expression)
  }
  const sets = fields.map((field, index) => {
    const [name, min, max] = FIELD_RANGES[index] ?? ['field', 0, 0]
    const values = field.split(',').flatMap((part) => numbersIn(part, min, max, name ?? 'field'))
    return new Set(values)
  })
  const weekdays = new Set([...(sets[4] ?? [])].map((day) => (day === 7 ? 0 : day)))
  return {
    minutes: sets[0] ?? new Set(),
    hours: sets[1] ?? new Set(),
    monthDays: sets[2] ?? new Set(),
    months: sets[3] ?? new Set(),
    weekdays,
  }
}

const isUnrestricted = (field: string): boolean => field.trim() === '*'

/** A clock reading, as minutes since midnight. */
const clockMinutes = (time: string): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (match === null) throw new Error('a time of day looks like 08:30: ' + time)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new Error('a time of day is within one day: ' + time)
  return hours * 60 + minutes
}

const dayMatches = (
  fields: CronFields,
  day: Date,
  domRestricted: boolean,
  dowRestricted: boolean,
): boolean => {
  if (!fields.months.has(day.getMonth() + 1)) return false
  const dom = fields.monthDays.has(day.getDate())
  const dow = fields.weekdays.has(day.getDay())
  // cron: with both restricted, either may match; otherwise the restricted one decides.
  if (domRestricted && dowRestricted) return dom || dow
  if (domRestricted) return dom
  if (dowRestricted) return dow
  return true
}

const firstMinuteOfDay = (
  fields: CronFields,
  day: Date,
  fromMinute: number,
): number | undefined => {
  for (let minute = fromMinute; minute < MINUTES_PER_DAY; minute += 1) {
    if (!fields.hours.has(Math.floor(minute / 60))) continue
    if (!fields.minutes.has(minute % 60)) continue
    const found = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute, 0, 0)
    return found.getTime()
  }
  return undefined
}

/** The next minute on the local clock that matches the fields, strictly after `base`. */
const nextMatchingMinute = (
  fields: CronFields,
  base: number,
  domRestricted: boolean,
  dowRestricted: boolean,
): number | undefined => {
  const start = new Date(base)
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)
  const firstDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())

  for (let offset = 0; offset < MAX_DAYS; offset += 1) {
    const day = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + offset)
    if (!dayMatches(fields, day, domRestricted, dowRestricted)) continue
    const from = offset === 0 ? start.getHours() * 60 + start.getMinutes() : 0
    const found = firstMinuteOfDay(fields, day, from)
    if (found !== undefined) return found
  }
  return undefined
}

const dailyFields = (minutesOfDay: number): CronFields => ({
  minutes: new Set([minutesOfDay % 60]),
  hours: new Set([Math.floor(minutesOfDay / 60)]),
  monthDays: new Set(),
  months: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  weekdays: new Set(),
})

/** Intervals count from the later of the schedule's creation and its last firing. */
const baseOf = (from: number, lastFired: number | undefined): number =>
  lastFired === undefined ? from : Math.max(from, lastFired)

const weeklyFields = (rule: {
  readonly weekdays: ReadonlyArray<number>
  readonly time: string
}): CronFields => {
  const weekdays = new Set(rule.weekdays.map((day) => (day === 7 ? 0 : day % 7)))
  return { ...dailyFields(clockMinutes(rule.time)), weekdays }
}

/** Fields are minute, hour, day of month, month, and day of week. */
const nextCron = (expression: string, base: number): number | undefined => {
  const parts = expression.trim().split(/\s+/)
  return nextMatchingMinute(
    parseCron(expression),
    base,
    !isUnrestricted(parts[2] ?? '*'),
    !isUnrestricted(parts[4] ?? '*'),
  )
}

/**
 * The instant a rule comes around next. A rule that never comes around has no
 * answer.
 */
export const nextDue = (
  rule: ScheduleRule,
  from: number,
  lastFired: number | undefined,
): number | undefined => {
  const base = baseOf(from, lastFired)
  if (rule.kind === 'every') return base + Math.max(rule.seconds, 1) * 1000
  if (rule.kind === 'daily') {
    return nextMatchingMinute(dailyFields(clockMinutes(rule.time)), base, false, false)
  }
  if (rule.kind === 'weekly') {
    return nextMatchingMinute(weeklyFields(rule), base, false, true)
  }
  return nextCron(rule.expression, base)
}
