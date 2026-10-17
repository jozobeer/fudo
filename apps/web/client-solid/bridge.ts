import { Effect, Fiber, Schedule } from 'effect'

/** How one failed call reads in the status strip. */
const messageOf = (error: unknown): string =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)

/**
 * The one place Effect runs for the page. Calls are not awaited by the view:
 * a value lands in a signal when it arrives, and a failure becomes the text the
 * status strip shows until the next move.
 */
export interface Bridge {
  /** Starts the program; a socket that drops is retried every second. */
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
      fiber = Effect.runFork(Effect.retry(program, Schedule.spaced('1 second')))
    },
    stop: () => {
      if (fiber !== undefined) void Effect.runPromise(Fiber.interrupt(fiber))
    },
    load: settle,
    run: (effect) => settle(effect, () => undefined),
  }
}
