import { Effect, Queue, Stream } from 'effect'
import { KeyDecoder, type KeyEvent } from './keys.ts'
import { DEFAULT_SIZE, type Size } from './wrap.ts'

/**
 * What the run loop needs from a terminal. Tests provide a script instead, so
 * the loop itself never touches a process stream.
 */
export interface TuiIo {
  readonly size: () => Size
  readonly keys: Stream.Stream<KeyEvent>
  readonly resizes: Stream.Stream<void>
  readonly write: (text: string) => void
  readonly setRaw: (on: boolean) => void
}

const textOf = (chunk: Uint8Array | string): string =>
  typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)

/** A lone escape is the Escape key once this much quiet has followed it. */
const ESCAPE_QUIET_MILLIS = 50

const keyStream = (): Stream.Stream<KeyEvent> =>
  Stream.callback<KeyEvent>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const decoder = new KeyDecoder()
        let quiet: ReturnType<typeof setTimeout> | undefined
        const stopQuiet = (): void => {
          if (quiet === undefined) return
          clearTimeout(quiet)
          quiet = undefined
        }
        const offer = (keys: ReadonlyArray<KeyEvent>): void => {
          for (const key of keys) Queue.offerUnsafe(queue, key)
        }
        const onData = (chunk: Uint8Array | string): void => {
          stopQuiet()
          offer(decoder.push(textOf(chunk)))
          // An escape may be the head of a sequence that is still arriving. Once
          // nothing follows it, it was the Escape key, and the UI should hear it.
          if (decoder.holdingEscape) {
            quiet = setTimeout(() => {
              quiet = undefined
              offer(decoder.flush())
            }, ESCAPE_QUIET_MILLIS)
          }
        }
        process.stdin.on('data', onData)
        process.stdin.resume()
        return { onData, stopQuiet }
      }),
      (held) =>
        Effect.sync(() => {
          held.stopQuiet()
          process.stdin.off('data', held.onData)
        }),
    ),
  )

const resizeStream = (): Stream.Stream<void> =>
  Stream.callback<void>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const onResize = (): void => {
          Queue.offerUnsafe(queue, undefined)
        }
        process.on('SIGWINCH', onResize)
        return onResize
      }),
      (onResize) =>
        Effect.sync(() => {
          process.off('SIGWINCH', onResize)
        }),
    ),
  )

/** The process terminal: stdin bytes as keys, stdout as the screen. */
export const processTuiIo = (): TuiIo => ({
  size: () => ({
    columns: process.stdout.columns ?? DEFAULT_SIZE.columns,
    rows: process.stdout.rows ?? DEFAULT_SIZE.rows,
  }),
  keys: keyStream(),
  resizes: resizeStream(),
  write: (text) => {
    process.stdout.write(text)
  },
  setRaw: (on) => {
    if (process.stdin.isTTY !== true) return
    process.stdin.setRawMode(on)
  },
})
