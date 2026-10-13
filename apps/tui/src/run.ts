import { Cause, Deferred, Effect, Ref, Stream } from 'effect'
import { sendCommand, type UiEvent, type UiHost } from '@fudo/ui-protocol'
import type { KeyEvent } from './keys.ts'
import { render, screenText } from './render.ts'
import { handleEvent, handleKey, initialTuiState, withNotice, type TuiState } from './state.ts'
import type { TuiIo } from './terminal.ts'

export interface RunTuiOptions {
  readonly title?: string
  readonly color?: boolean
  /** Completes to stop the UI, e.g. on SIGINT; the terminal is restored. */
  readonly interrupt?: Effect.Effect<void>
}

type Input =
  | { readonly kind: 'event'; readonly event: UiEvent }
  | { readonly kind: 'key'; readonly key: KeyEvent }
  | { readonly kind: 'resize' }

/** Alternate screen on, cursor hidden. */
const ENTER_SCREEN = '\u001b[?1049h\u001b[?25l'
/** Cursor shown, alternate screen off. */
const LEAVE_SCREEN = '\u001b[?25h\u001b[?1049l'

const inputsOf = (host: UiHost, io: TuiIo): Stream.Stream<Input> =>
  Stream.merge(
    host.events.pipe(Stream.map((event) => ({ kind: 'event' as const, event }))),
    Stream.merge(
      io.keys.pipe(Stream.map((key) => ({ kind: 'key' as const, key }))),
      io.resizes.pipe(Stream.map(() => ({ kind: 'resize' as const }))),
    ),
  )

/**
 * Runs one terminal UI over a host until the user leaves. Returns the process
 * exit code (0 normally, 130 when interrupted by a signal).
 */
export const runTui = (host: UiHost, io: TuiIo, options?: RunTuiOptions): Effect.Effect<number> =>
  Effect.scoped(
    Effect.gen(function* () {
      const color = options?.color ?? true
      const state = yield* Ref.make<TuiState>({
        ...initialTuiState,
        ...(options?.title === undefined ? {} : { title: options.title }),
      })
      const done = yield* Deferred.make<number>()

      const repaint = (): Effect.Effect<void> =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state)
          io.write(screenText(render(current, io.size(), { color })))
        })

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          io.setRaw(true)
          io.write(ENTER_SCREEN)
        }),
        () =>
          Effect.sync(() => {
            io.write(LEAVE_SCREEN)
            io.setRaw(false)
          }),
      )
      yield* repaint()

      const onInput = (input: Input): Effect.Effect<void> =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state)
          if (input.kind === 'event') {
            yield* Ref.set(state, handleEvent(current, input.event))
            yield* repaint()
            return
          }
          if (input.kind === 'resize') {
            yield* repaint()
            return
          }
          const outcome = handleKey(current, input.key)
          yield* Ref.set(state, outcome.state)
          yield* repaint()
          for (const command of outcome.commands) {
            yield* sendCommand(host, command).pipe(
              Effect.catchCause((cause) =>
                Effect.gen(function* () {
                  yield* Ref.update(state, (value) =>
                    withNotice(value, 'error', 'command failed: ' + Cause.pretty(cause)),
                  )
                  yield* repaint()
                }),
              ),
            )
          }
          if (outcome.exit) yield* Deferred.succeed(done, 0)
        })

      const stopped =
        options?.interrupt === undefined
          ? Deferred.await(done)
          : Effect.raceFirst(Deferred.await(done), options.interrupt.pipe(Effect.as(130)))
      return yield* Effect.raceFirst(
        Stream.runForEach(inputsOf(host, io), onInput).pipe(Effect.as(0)),
        stopped,
      )
    }),
  )
