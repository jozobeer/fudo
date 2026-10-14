/** The bytes one search page may hold; a longer page would be spilled again by the pipeline. */
export const SEARCH_PAGE_BYTES = 30_000

/**
 * Takes the items one page shows: at most `pageSize` of them and at most
 * `budgetBytes` of rendered text, whichever comes first. At least one item is
 * always shown, so a single long item still reaches the model. The caller knows
 * the page is partial whenever it shows fewer items than the search found.
 */
export const takePage = <T>(
  items: ReadonlyArray<T>,
  pageSize: number,
  lineOf: (item: T) => string,
  budgetBytes = SEARCH_PAGE_BYTES,
): ReadonlyArray<T> => {
  const shown: Array<T> = []
  let bytes = 0
  for (const item of items) {
    if (shown.length >= pageSize) break
    const size = Buffer.byteLength(lineOf(item), 'utf8') + 1
    if (shown.length > 0 && bytes + size > budgetBytes) break
    shown.push(item)
    bytes += size
  }
  return shown
}
