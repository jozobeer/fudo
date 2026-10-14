/**
 * The doc gate: every relative markdown link in the docs and README must point
 * at a file that is there, and every `fudo:<path>` reference must name a path
 * this checkout holds. Documents are read as claims about the repository, so a
 * renamed file stops the check instead of quietly making the docs wrong.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = process.cwd()
const problems: Array<string> = []

const walk = (directory: string, into: Array<string>): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path, into)
    else if (entry.name.endsWith('.md')) into.push(path)
  }
}

const documents: Array<string> = []
if (existsSync(join(root, 'README.md'))) documents.push(join(root, 'README.md'))
walk(join(root, 'docs'), documents)

const shown = (path: string): string => relative(root, path).split('\\').join('/')

const linkTargets = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(/\]\(([^)\s]+)\)/g)].flatMap((match) => {
    const target = match[1] ?? ''
    if (/^(https?:|mailto:|#)/.test(target)) return []
    const clean = target.split('#')[0] ?? ''
    return clean === '' ? [] : [clean]
  })

const fudoPaths = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(/fudo:([A-Za-z0-9_./-]*\/[A-Za-z0-9_./-]+)/g)].flatMap((match) => {
    const raw = (match[1] ?? '').replace(/:\d+(-\d+)?$/, '')
    return raw === '' ? [] : [raw]
  })

for (const document of documents) {
  const text = readFileSync(document, 'utf8')
  for (const target of linkTargets(text)) {
    if (!existsSync(resolve(dirname(document), target))) {
      problems.push(shown(document) + ': link points nowhere: ' + target)
    }
  }
  for (const reference of fudoPaths(text)) {
    if (!existsSync(join(root, reference))) {
      problems.push(shown(document) + ': names a path that is not there: ' + reference)
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write('fudo: ' + problem + '\n')
  process.exit(1)
}
process.stdout.write(
  'docs: ' + String(documents.length) + ' files checked, every link and fudo: path resolves\n',
)
