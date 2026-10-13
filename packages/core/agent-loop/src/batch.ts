/** One group of calls the loop may run together. */
export interface CallBatch<C> {
  /** True when the group holds more than one safe call. */
  readonly parallel: boolean
  readonly calls: ReadonlyArray<C>
}

/**
 * Groups consecutive calls that may run at the same time. A safe call only
 * joins a group when another safe call follows it; everything else stays a
 * single-call batch, so order is preserved around unsafe calls.
 */
export function groupCalls<C>(
  calls: ReadonlyArray<C>,
  safe: (call: C) => boolean,
): ReadonlyArray<CallBatch<C>> {
  const batches: Array<CallBatch<C>> = []
  let run: Array<C> = []
  const flush = (): void => {
    if (run.length > 1) batches.push({ parallel: true, calls: run })
    else if (run.length === 1) batches.push({ parallel: false, calls: run })
    run = []
  }
  for (const call of calls) {
    if (safe(call)) {
      run.push(call)
      continue
    }
    flush()
    batches.push({ parallel: false, calls: [call] })
  }
  flush()
  return batches
}
