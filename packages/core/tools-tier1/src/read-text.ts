import { readFile } from 'node:fs/promises'
import { Effect } from 'effect'

/** A file's UTF-8 text, or undefined when it cannot be read. */
export const readIfPresent = (path: string): Effect.Effect<string | undefined> =>
  Effect.promise(() =>
    readFile(path, 'utf8').then(
      (text) => text,
      () => undefined,
    ),
  )
