import { Effect } from 'effect'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadAgentsFiles } from '../src/index.ts'

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
