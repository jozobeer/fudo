import { Effect } from 'effect'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  agentsMdSections,
  loadAgentsFiles,
  makeSystemPrompt,
  registerAgentsMd,
} from '../src/index.ts'

describe('loadAgentsFiles', () => {
  test('reads the nearest file first and stops at the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-agents-'))
    const nested = join(root, 'a', 'b')
    await Bun.write(join(root, 'AGENTS.md'), 'outer rules\n')
    await Bun.write(join(nested, 'AGENTS.md'), 'inner rules\n')
    await (async () => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(nested, { recursive: true })
      await Bun.write(join(nested, 'AGENTS.md'), 'inner rules\n')
    })()

    const found = await Effect.runPromise(loadAgentsFiles(nested))

    expect(found[0]).toEqual({ path: join(nested, 'AGENTS.md'), text: 'inner rules\n' })
    expect(found.some((file) => file.path === join(root, 'AGENTS.md'))).toBe(true)
    expect(found.every((file) => file.path.endsWith('AGENTS.md'))).toBe(true)
    await rm(root, { recursive: true, force: true })
  })
})

describe('agentsMdSections', () => {
  test('gives the nearest file the highest order', () => {
    const sections = agentsMdSections(
      [
        { path: '/work/a/AGENTS.md', text: 'inner\n' },
        { path: '/work/AGENTS.md', text: 'outer\n' },
      ],
      10,
    )

    expect(sections.map((section) => section.name)).toEqual(['agents-md:1', 'agents-md:2'])
    expect(sections.map((section) => section.order)).toEqual([12, 11])
    expect(sections[0]?.text).toBe('Instructions from /work/a/AGENTS.md:\ninner')
  })
})

describe('registerAgentsMd', () => {
  test('registers the files on a prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-agents-'))
    await Bun.write(join(root, 'AGENTS.md'), 'outer rules\n')

    const rendered = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const prompt = makeSystemPrompt()
          yield* registerAgentsMd(prompt, root)
          return yield* prompt.render({ variables: {} })
        }),
      ),
    )

    expect(rendered).toContain('outer rules')
    expect(rendered).toContain('Instructions from ' + join(root, 'AGENTS.md'))
    await rm(root, { recursive: true, force: true })
  })
})
