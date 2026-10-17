import { toolsOf, writtenPath, type TraceTurn } from '../client/trace.ts'

/** One change to one file, as the edit or write call carried it. */
export interface FileEdit {
  readonly turn: number
  readonly tool: string
  readonly result: string
  /** The lines the call took away; empty for a write. */
  readonly removed: ReadonlyArray<string>
  readonly added: ReadonlyArray<string>
}

const linesOf = (value: unknown): ReadonlyArray<string> =>
  typeof value === 'string' && value !== '' ? value.split('\n') : []

const argsOf = (args: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(args)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Every change the session made to one file, oldest first. */
export const editsOf = (turns: ReadonlyArray<TraceTurn>, path: string): ReadonlyArray<FileEdit> =>
  turns.flatMap((turn) =>
    toolsOf(turn)
      .filter((tool) => writtenPath(tool.name, tool.args) === path)
      .map((tool) => {
        const args = argsOf(tool.args)
        return {
          turn: turn.turn,
          tool: tool.name,
          result: tool.result,
          removed: linesOf(args['old_string']),
          added: linesOf(args['new_string'] ?? args['content']),
        }
      }),
  )

/** Every file the session wrote, each once, in the order it was first written. */
export const changedFilesOf = (turns: ReadonlyArray<TraceTurn>): ReadonlyArray<string> => [
  ...new Set(turns.flatMap((turn) => turn.changed.map((file) => file.path))),
]

/** A span of time the way the page says it: 0.3s, 38s, 4m 12s, 1h 03m. */
export const spanOf = (ms: number): string => {
  if (ms < 10_000) return (Math.max(0, ms) / 1000).toFixed(1) + 's'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return String(seconds) + 's'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return String(minutes) + 'm ' + String(seconds % 60).padStart(2, '0') + 's'
  return String(Math.floor(minutes / 60)) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm'
}
