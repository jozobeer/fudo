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

const keyStream = (): Stream.Stream<KeyEvent> =>
  Stream.callback<KeyEvent>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const decoder = new KeyDecoder()
        const onData = (chunk: Uint8Array | string): void => {
          for (const key of decoder.push(textOf(chunk))) Queue.offerUnsafe(queue, key)
        }
        process.stdin.on('data', onData)
        process.stdin.resume()
        return onData
      }),
      (onData) =>
        Effect.sync(() => {
          process.stdin.off('data', onData)
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
