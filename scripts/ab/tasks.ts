/**
 * The coding tasks both harnesses are asked to do. Each one starts from a
 * fresh workspace, and whether it is done is judged from the files afterwards —
 * never from what the model said about itself.
 */

import { findDisagreement } from './find-task.ts'
import { longPrompt } from './prompt-task.ts'
import { readReport } from './read-task.ts'
import { fixRules } from './rules-task.ts'

export interface AbTask {
  readonly name: string
  /** What the task asks for, verbatim, to both harnesses. */
  readonly prompt: string
  /** Files the workspace starts with, keyed by a path relative to it. */
  readonly files: Readonly<Record<string, string>>
  /** How long one run may take; the run script's default when absent. */
  readonly timeoutMs?: number
  /** Whether the work landed, read from the workspace. */
  readonly done: (workspace: string) => Promise<boolean>
}

const textOf = async (path: string): Promise<string> =>
  Bun.file(path)
    .text()
    .catch(() => '')

export const TASKS: ReadonlyArray<AbTask> = [
  {
    name: 'fix-add',
    prompt:
      'src/math.ts has a bug: add subtracts instead of adding. Fix src/math.ts so add returns the sum of its two arguments. Change nothing else.',
    files: {
      'src/math.ts':
        'export const add = (a: number, b: number): number => a - b\n' +
        'export const multiply = (a: number, b: number): number => a * b\n',
    },
    done: async (workspace) => {
      const text = await textOf(workspace + '/src/math.ts')
      return text.includes('a + b') && text.includes('a * b') && !text.includes('a - b')
    },
  },
  {
    name: 'write-notes',
    prompt:
      'Create a file notes.md in the working directory. It must contain a level-1 heading with the text Notes, then a line that reads exactly: status: ready',
    files: {},
    done: async (workspace) => {
      const text = await textOf(workspace + '/notes.md')
      return text.includes('# Notes') && text.includes('status: ready')
    },
  },
  {
    name: 'rename-function',
    prompt:
      'Rename the exported function fetchValue to readValue everywhere under src/, updating every place that imports or calls it. Leave no mention of fetchValue behind.',
    files: {
      'src/util.ts': 'export const fetchValue = (): number => 1\n',
      'src/use.ts':
        "import { fetchValue } from './util'\n\nexport const use = (): number => fetchValue()\n",
    },
    done: async (workspace) => {
      const util = await textOf(workspace + '/src/util.ts')
      const use = await textOf(workspace + '/src/use.ts')
      return (
        util.includes('readValue') &&
        use.includes('readValue') &&
        !util.includes('fetchValue') &&
        !use.includes('fetchValue')
      )
    },
  },
  fixRules,
  readReport,
  longPrompt,
  findDisagreement,
]
