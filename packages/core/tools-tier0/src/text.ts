import { Effect } from 'effect'
import { ToolError } from '@fudo/tools'

/** Reads a file as UTF-8 text; anything that is not UTF-8 is refused, not replaced. */
export const readUtf8 = (path: string): Effect.Effect<string, ToolError> =>
  Effect.gen(function* () {
    const bytes = yield* Effect.tryPromise({
      try: () => Bun.file(path).arrayBuffer(),
      catch: () => new ToolError({ code: 'execution', message: 'cannot read ' + path }),
    })
    return yield* Effect.try({
      try: () => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      catch: () => new ToolError({ code: 'execution', message: 'not a UTF-8 text file: ' + path }),
    })
  })

/** The lines of a file, without the empty line a trailing newline would add. */
export const linesOf = (text: string): ReadonlyArray<string> => {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** One line ending everywhere, so a match never depends on the platform that wrote it. */
export const normalizeNewlines = (text: string): string => text.replace(/\r\n/g, '\n')
