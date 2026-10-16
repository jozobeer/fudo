import { Effect } from 'effect'
import { describe, expect, test } from 'bun:test'
import { tier0Tools } from '../src/index.ts'

describe('tier0Tools', () => {
  test('lists the six tools with their declared needs', () => {
    const tools = tier0Tools()

    expect(tools.map((tool) => tool.name)).toEqual([
      'read',
      'write',
      'edit',
      'glob',
      'grep',
      'bash',
    ])
    expect(tools.map((tool) => ({ name: tool.name, needs: tool.needs ?? [] }))).toEqual([
      { name: 'read', needs: ['read'] },
      { name: 'write', needs: ['write'] },
      { name: 'edit', needs: ['write'] },
      { name: 'glob', needs: ['read'] },
      { name: 'grep', needs: ['read'] },
      { name: 'bash', needs: ['exec'] },
    ])
  })

  test('the sandbox the caller passes is the one bash uses', async () => {
    const tools = tier0Tools({
      name: 'test',
      confines: true,
      mode: 'workspace-write',
      wrap: (command) =>
        Effect.succeed({ argv: ['bash', '-lc', 'echo wrapped'], cwd: command.cwd }),
    })
    const bash = tools.find((tool) => tool.name === 'bash')
    const value = await Effect.runPromise(
      bash?.execute({ command: 'echo raw' }, { sessionId: 's1', cwd: '/tmp', callId: 'c1' }) ??
        Effect.succeed({ exitCode: -1, stdout: '', stderr: '' }),
    )

    expect(value.stdout).toBe('wrapped\n')
  })
})
