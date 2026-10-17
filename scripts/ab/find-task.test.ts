import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { findDisagreement } from './find-task.ts'

/** Every crate in a file with the counts the file gives it. */
const countsOf = (text: string): ReadonlyMap<string, ReadonlySet<number>> => {
  const counts = new Map<string, Set<number>>()
  for (const line of text.split('\n')) {
    const crate = /C-\d{5}/.exec(line)?.[0]
    const units = /(\d+) units/.exec(line)?.[1]
    if (crate === undefined || units === undefined) continue
    const seen = counts.get(crate) ?? new Set<number>()
    seen.add(Number(units))
    counts.set(crate, seen)
  }
  return counts
}

const disagreeingFiles = (): ReadonlyArray<string> =>
  Object.entries(findDisagreement.files).flatMap(([path, text]) =>
    [...countsOf(text).values()].some((seen) => seen.size > 1) ? [path] : [],
  )

describe('the find-disagreement workspace', () => {
  test('one file counts a crate two ways, and every crate is counted twice', () => {
    expect(disagreeingFiles()).toEqual(['data/c36.txt'])

    for (const text of Object.values(findDisagreement.files)) {
      const counts = countsOf(text)
      expect(counts.size).toBe(100)
      expect([...counts.values()].every((seen) => seen.size === 1)).toBe(
        text !== findDisagreement.files['data/c36.txt'],
      )
    }
  })

  test('the answer it judges is the one the workspace holds', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-find-'))
    const faulty = findDisagreement.files['data/c36.txt'] ?? ''
    const seen = [...(countsOf(faulty).get('C-36041') ?? [])]
    const wrong = [...(countsOf(findDisagreement.files['data/c26.txt'] ?? '').get('C-26041') ?? [])]

    await writeFile(
      join(workspace, 'answer.md'),
      ['data/c36.txt', 'C-36041', String(seen[0]), String(seen[1])].join('\n'),
    )
    expect(await findDisagreement.done(workspace)).toBe(true)

    // A file whose counts agree cannot be the answer, whatever else it names.
    await writeFile(
      join(workspace, 'answer.md'),
      ['data/c26.txt', 'C-26041', String(wrong[0]), String(wrong[1])].join('\n'),
    )
    expect(await findDisagreement.done(workspace)).toBe(false)

    await rm(workspace, { recursive: true, force: true })
  })
})
