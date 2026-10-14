/** A log split into what was written complete, and the tail a crash left behind. */
export interface SplitLog {
  readonly keep: string
  readonly tornBytes: number
}

/**
 * Splits a log at the last complete line. Our writer appends one line at a time,
 * newline included, so a last line without its newline was cut short: the bytes
 * after the previous newline are what a crash left behind. A log that ends inside
 * a value, or with no newline at all, keeps everything up to there.
 */
export const splitTornTail = (text: string): SplitLog =>
  text === '' || text.endsWith('\n')
    ? { keep: text, tornBytes: 0 }
    : (() => {
        const lastBreak = text.lastIndexOf('\n')
        const keep = lastBreak === -1 ? '' : text.slice(0, lastBreak + 1)
        return { keep, tornBytes: text.length - keep.length }
      })()
