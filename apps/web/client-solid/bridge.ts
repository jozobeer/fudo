import { Cause, Effect, Fiber } from 'effect'

/** How one failed call reads in the status strip. */
const messageOf = (error: unknown): string =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)

/** How long the page waits before it opens the socket again. */
const RETRY_DELAY = '1 second'

/**
 * The one place Effect runs for the page. Calls are not awaited by the view:
 * a value lands in a signal when it arrives, and a failure becomes the text the
 * status strip shows until the next move.
 */
export interface Bridge {
  /** Starts the program; a program that ends is started again every second. */
  start: (program: Effect.Effect<void, unknown>) => void
  /** Stops the program, for a page that is going away. */
  stop: () => void
  /** Runs one call and hands its value to `sink`. */
  load: <A>(effect: Effect.Effect<A, unknown, unknown>, sink: (value: A) => void) => void
  /** Runs one call for its effect only. */
  run: (effect: Effect.Effect<unknown, unknown, unknown>) => void
}

export const makeBridge = (onProblem: (message: string) => void): Bridge => {
  let fiber: Fiber.Fiber<void, unknown> | undefined
  const settle = <A>(
    effect: Effect.Effect<A, unknown, unknown>,
    next: (value: A) => void,
  ): void => {
    void Effect.runPromise(
      effect.pipe(
        Effect.match({
          onFailure: (error) => onProblem(messageOf(error)),
          onSuccess: (value) => next(value),
        }),
      ) as Effect.Effect<void, never>,
    ).catch(() => undefined)
  }
  return {
    start: (program) => {
      // A defect ends the program the same as a failure does, and a page whose
      // program is gone takes input it will never send. Both are reported and
      // opened again, so the socket is never left dead in silence.
      fiber = Effect.runFork(
        program.pipe(
          // An interruption is `stop()`; a failure is the socket, and it starts again.
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.sync(() => onProblem(messageOf(Cause.squash(cause)))),
          ),
          Effect.andThen(Effect.sleep(RETRY_DELAY)),
          Effect.forever,
        ) as Effect.Effect<never>,
      )
    },
    stop: () => {
      if (fiber !== undefined) void Effect.runPromise(Fiber.interrupt(fiber))
    },
    load: settle,
    run: (effect) => settle(effect, () => undefined),
  }
}
