import { Effect, Stream } from 'effect'
import { main, type MainIo } from './bin.ts'

export interface ProcessIo extends MainIo {
  /** True when the process owns a terminal; piped input becomes REPL lines. */
  readonly isTty: boolean
  readonly readStdin: () => Promise<string>
}

/** Lines of piped input: the trailing empty line after the final newline is dropped. */
export const linesOf = (text: string): ReadonlyArray<string> => {
  const parts = text.split('\n')
  return parts.length > 0 && parts[parts.length - 1] === '' ? parts.slice(0, -1) : parts
}

/** Wires the entry point to a process: piped stdin becomes REPL lines. */
export function runFudo(argv: ReadonlyArray<string>, io: ProcessIo): Effect.Effect<number> {
  return Effect.gen(function* () {
    const text = io.isTty
      ? ''
      : yield* Effect.match(
          Effect.tryPromise({
            try: () => io.readStdin(),
            catch: (cause) => new Error('cannot read stdin: ' + String(cause)),
          }),
          { onFailure: () => '', onSuccess: (value) => value },
        )
    return yield* main(argv, {
      stdout: io.stdout,
      stderr: io.stderr,
      cwd: io.cwd,
      ...(io.isTty ? {} : { lines: Stream.fromIterable(linesOf(text)) }),
    })
  })
}
