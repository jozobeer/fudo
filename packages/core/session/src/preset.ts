import { Schema } from 'effect'
import { registerLogOnlySessionEvents } from './projections.ts'
import { registerSessionEventSchemas, type SessionEventSchemaMap } from './schemas.ts'
import type { SessionEvent } from './events.ts'

/** The composition a session runs with: what was chosen, and what it added up to. */
export interface Preset {
  /** The profile documents, first layer first, as the caller named them. */
  readonly profiles: ReadonlyArray<string>
  /** Every tool the session could call when it started. */
  readonly tools: ReadonlyArray<string>
}

declare module './events.ts' {
  interface SessionEventMap {
    'preset/selected': Preset
  }
}

/** Schemas for the session events this module adds. */
export const presetEventSchemas: SessionEventSchemaMap = new Map<string, Schema.Schema<unknown>>([
  [
    'preset/selected',
    Schema.Struct({ profiles: Schema.Array(Schema.String), tools: Schema.Array(Schema.String) }),
  ],
])

registerSessionEventSchemas(presetEventSchemas)
// Which tools a session was given is the harness's business, not the model's.
registerLogOnlySessionEvents(['preset/selected'])

/** The composition this session recorded, or nothing when it never recorded one. */
export const currentPreset = (events: ReadonlyArray<SessionEvent>): Preset | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'preset/selected') return event.data
  }
  return undefined
}

const names = (values: ReadonlyArray<string>): string =>
  values.length === 0 ? 'none' : values.join(', ')

/** How a composition reads in one line. */
export const describePreset = (preset: Preset): string =>
  'profiles ' + names(preset.profiles) + '; ' + String(preset.tools.length) + ' tools'

const sorted = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...values].sort()

/** The tools one set has that the other does not, in a stable order. */
const difference = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): ReadonlyArray<string> => sorted(left.filter((value) => !right.includes(value)))

/**
 * Why running this session under a different composition would be a mistake, in
 * the words a human needs to fix it. Nothing when the two agree.
 */
export const presetProblem = (recorded: Preset, current: Preset): string | undefined => {
  const lines: Array<string> = []
  if (names(sorted(recorded.profiles)) !== names(sorted(current.profiles))) {
    lines.push('profiles: ' + names(recorded.profiles) + ' -> ' + names(current.profiles))
  }
  const gone = difference(recorded.tools, current.tools)
  const added = difference(current.tools, recorded.tools)
  if (gone.length > 0) lines.push('tools gone: ' + gone.join(', '))
  if (added.length > 0) lines.push('tools new: ' + added.join(', '))
  if (lines.length === 0) return undefined
  return (
    'this session was started with ' +
    describePreset(recorded) +
    ';\n  ' +
    lines.join('\n  ') +
    '\nstart a new session, or pass --allow-preset-change to continue under this one'
  )
}
