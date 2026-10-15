import { SESSION_FORMAT_VERSION, type SessionHeader } from '@jozo-harness/session'

/** What a reader knows that an old header does not say for itself. */
export interface UpgradeContext {
  /** When the file was last written; the best fact we have for an old createdAt. */
  readonly mtimeMs: number
}

/** The header came from a log this build cannot interpret. */
export interface UpgradeProblem {
  readonly message: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** How far a header is behind, or a problem when it is not behind at all. */
const versionOf = (header: Record<string, unknown>): number | UpgradeProblem => {
  const version = header.formatVersion
  if (version === undefined) return 0
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { message: 'the header does not say which format it is' }
  }
  return version > SESSION_FORMAT_VERSION
    ? {
        message:
          'this session was written by a newer jozo-harness (formatVersion ' +
          String(version) +
          '); this build reads up to ' +
          String(SESSION_FORMAT_VERSION),
      }
    : version
}

/** One step of the chain: a header of this version, carried forward one step. */
type Upgrade = (header: Record<string, unknown>, context: UpgradeContext) => Record<string, unknown>

/**
 * The upgrade table, oldest first. v0 is a header that does not say which format it
 * is: the log never recorded where it was written, so cwd says so instead of naming
 * a directory that would then be repeated as if it were true.
 */
const UPGRADES: ReadonlyArray<Upgrade> = [
  (header, context) => ({
    ...header,
    formatVersion: 1,
    createdAt: typeof header.createdAt === 'number' ? header.createdAt : context.mtimeMs,
    cwd: typeof header.cwd === 'string' ? header.cwd : '(not recorded)',
  }),
]

/**
 * Reads the first line of a log — the event envelope around a header — into this
 * build's shape. The rest of the log is decoded as usual; only the header carries
 * the format generation, so only the header has to be carried forward.
 */
export const upgradeHeaderLine = (
  raw: unknown,
  context: UpgradeContext,
):
  | { readonly line: unknown; readonly from: number; readonly changed: boolean }
  | UpgradeProblem => {
  if (!isRecord(raw)) return { message: 'the first line of the session is not an event' }
  const carried = upgradeHeader(raw.data, context)
  if (!('header' in carried)) return carried
  return { line: { ...raw, data: carried.header }, from: carried.from, changed: carried.changed }
}

/**
 * Reads a header of any generation this build knows into the current one. The
 * table walks forward one version at a time, so a log written years ago keeps
 * working instead of becoming unreadable the first time the shape changed.
 */
export const upgradeHeader = (
  raw: unknown,
  context: UpgradeContext,
):
  | { readonly header: SessionHeader; readonly from: number; readonly changed: boolean }
  | UpgradeProblem => {
  if (!isRecord(raw)) return { message: 'the first line of the session is not a header' }
  const from = versionOf(raw)
  if (typeof from !== 'number') return from
  if (from === SESSION_FORMAT_VERSION)
    return { header: raw as unknown as SessionHeader, from, changed: false }
  let carried = raw
  for (let version = from; version < SESSION_FORMAT_VERSION; version += 1) {
    const step = UPGRADES[version]
    if (step === undefined) {
      return { message: 'no way to read a session of formatVersion ' + String(version) }
    }
    carried = step(carried, context)
  }
  return { header: carried as unknown as SessionHeader, from, changed: true }
}
