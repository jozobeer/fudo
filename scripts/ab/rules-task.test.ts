import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { FAULTY_RULES, fixRules, ruleFiles, wrongRules } from './rules-task.ts'

const workspaces: Array<string> = []

const workspaceWith = async (files: Readonly<Record<string, string>>): Promise<string> => {
  const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-ab-rules-'))
  workspaces.push(workspace)
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(workspace, path)), { recursive: true })
    await writeFile(join(workspace, path), text)
  }
  return workspace
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('the long A/B task', () => {
  test('the judge finds every planted fault and nothing else', async () => {
    const workspace = await workspaceWith(fixRules.files)

    expect(wrongRules(workspace)).toEqual(FAULTY_RULES)
    expect(await fixRules.done(workspace)).toBe(false)
  })

  test('a workspace with every fault fixed is done', async () => {
    const workspace = await workspaceWith(ruleFiles(new Set(FAULTY_RULES)))

    expect(wrongRules(workspace)).toEqual([])
    expect(await fixRules.done(workspace)).toBe(true)
  })

  test('one fault left behind keeps the task open', async () => {
    const [left, ...fixed] = FAULTY_RULES
    const workspace = await workspaceWith(ruleFiles(new Set(fixed)))

    expect(wrongRules(workspace)).toEqual([left!])
  })

  test('a rule that no longer loads counts as wrong', async () => {
    const files = { ...ruleFiles(new Set(FAULTY_RULES)), 'src/rules/r07.ts': 'export {' }
    const workspace = await workspaceWith(files)

    expect(wrongRules(workspace)).toEqual(['07'])
  })
})
