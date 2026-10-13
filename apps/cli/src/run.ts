#!/usr/bin/env bun
import { Deferred, Effect, Stream } from 'effect'
import { main, type MainIo } from './bin.ts'
import { runAuthAtStart } from './auth-cli.ts'

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
      ...(io.interrupt === undefined ? {} : { interrupt: io.interrupt }),
      ...(io.isTty && text === '' ? {} : { lines: Stream.fromIterable(linesOf(text)) }),
    })
  })
}

/** The real entry point: streams, stdin, and the process exit code. */
export function runAsProcess(argv: ReadonlyArray<string>): void {
  if (argv[0] === 'auth') {
    void runAuthAtStart(argv).then((code) => {
      process.exitCode = code ?? 0
    })
    return
  }

  void runFudo(argv, {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: process.cwd(),
    isTty: process.stdin.isTTY === true,
    readStdin: () => readChunks(process.stdin),
    interrupt: interruptOnSignal(),
  })
    .pipe(Effect.runPromise)
    .then((code) => {
      process.exitCode = code
    })
}

if (import.meta.main) runAsProcess(Bun.argv.slice(2))

/** Completes when the process receives SIGINT; the running turn is cancelled. */
export function interruptOnSignal(): Effect.Effect<void> {
  return Effect.gen(function* () {
    const signal = yield* Deferred.make<void>()
    const onSignal = (): void => {
      void Effect.runSync(Deferred.succeed(signal, undefined))
    }
    yield* Effect.sync(() => {
      process.once('SIGINT', onSignal)
    })
    return yield* Deferred.await(signal)
  })
}

/** Reads a chunk source to its end as UTF-8 text; a TTY ends at Ctrl-D. */
export async function readChunks(chunks: AsyncIterable<Uint8Array | string>): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of chunks) {
    text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
  }
  return text
}
