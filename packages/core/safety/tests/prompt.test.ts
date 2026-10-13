import { Effect } from 'effect'
import { describe, expect, test } from 'bun:test'
import { promptForApproval, type ApprovalRequested } from '../src/index.ts'

const request: ApprovalRequested = {
  callId: 'c1',
  tool: 'bash',
  reason: 'preset read-only does not allow: exec',
}

const ask = (answer: string | undefined) => {
  const written: Array<string> = []
  return Effect.runPromise(
    promptForApproval({
      write: (text) => Effect.sync(() => void written.push(text)),
      readLine: () => Effect.succeed(answer),
    })(request).pipe(Effect.map((approved) => ({ approved, written: written.join('') }))),
  )
}

describe('promptForApproval', () => {
  test('shows the tool and the reason', async () => {
    const observed = await ask('n')

    expect(observed.written).toContain('allow bash?')
    expect(observed.written).toContain('preset read-only does not allow: exec')
  })

  test('only an explicit yes approves', async () => {
    expect((await ask('y')).approved).toBe(true)
    expect((await ask('  Yes ')).approved).toBe(true)
    expect((await ask('n')).approved).toBe(false)
    expect((await ask('')).approved).toBe(false)
    expect((await ask(undefined)).approved).toBe(false)
  })
})
