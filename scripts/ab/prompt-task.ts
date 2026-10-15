/**
 * The line-filling A/B task: one prompt large enough that the first request is already
 * past the shipped line — 128,000 × 0.8 against 128,000 - 65,536, so 62,464 tokens — and
 * compaction has to fire before the model ever answers. The prompt ends with the work
 * to do, so a run that compacts and still lands the file is judged done from disk.
 *
 * The filler is deliberately one user message: it is the cheapest way to carry a real
 * session past the line, where a task over files can be answered by reading less.
 */

import type { AbTask } from './tasks.ts'

const LINES = 4_000
const LINE = 'The quick brown fox jumps over the lazy dog, and the note below says so. '

const filler = (): string =>
  Array.from({ length: LINES }, (_, index) => String(index + 1) + ' ' + LINE).join('\n')

export const longPrompt: AbTask = {
  name: 'long-prompt',
  prompt:
    filler() +
    '\n\nThe text above is filler. Create a file done.md whose single line reads exactly: status: ok',
  files: {},
  timeoutMs: 600_000,
  done: async (workspace) => {
    const text = await Bun.file(workspace + '/done.md')
      .text()
      .catch(() => '')
    return text.includes('status: ok')
  },
}
