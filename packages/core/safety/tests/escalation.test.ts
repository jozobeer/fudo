import { describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import {
  approveEscalation,
  escalationHintMarker,
  sandboxDenialMarker,
  validateEscalationArgs,
  type ApprovalRequested,
} from '../src/index.ts'

const asked: Array<ApprovalRequested> = []

/** Answers every escalation with `approved`, recording what was asked. */
const answerer = (approved: boolean) => (request: ApprovalRequested) =>
  Effect.sync(() => {
    asked.push(request)
    return approved
  })

const escalate = (
  requestedMode: string,
  standingMode: 'read-only' | 'workspace-write' | 'danger-full-access',
  approved: boolean,
) =>
  Effect.runPromise(
    approveEscalation(
      {
        requestedMode,
        justification: 'the build writes outside the workspace',
        standingMode,
        subject: 'command',
        callId: 'c1',
        tool: 'bash',
      },
      answerer(approved),
    ).pipe(Effect.result),
  )

describe('validateEscalationArgs', () => {
  test('the mode and its reason travel together, and the reason is a sentence', () => {
    expect(() => validateEscalationArgs('danger-full-access', undefined)).toThrow()
    expect(() => validateEscalationArgs(undefined, 'because')).toThrow()
    expect(() => validateEscalationArgs('danger-full-access', '   ')).toThrow()
    expect(() => validateEscalationArgs(undefined, undefined)).not.toThrow()
    expect(() =>
      validateEscalationArgs('danger-full-access', 'the build writes outside'),
    ).not.toThrow()
  })
})

describe('approveEscalation', () => {
  test('a wider mode runs once the human says yes, and the reason names both modes', async () => {
    asked.length = 0
    const observed = await escalate('danger-full-access', 'workspace-write', true)

    expect(observed._tag).toBe('Success')
    if (observed._tag === 'Success') expect(observed.success).toBe('danger-full-access')
    expect(asked).toHaveLength(1)
    expect(asked[0]?.reason).toContain('danger-full-access')
    expect(asked[0]?.reason).toContain('the build writes outside the workspace')
  })

  test('a refusal keeps the call denied', async () => {
    asked.length = 0
    const observed = await escalate('workspace-write', 'read-only', false)

    expect(observed._tag).toBe('Failure')
    if (observed._tag === 'Failure') expect(String(observed.failure)).toContain('rejected')
    expect(asked).toHaveLength(1)
  })

  test('a mode that is not strictly wider is refused without asking', async () => {
    asked.length = 0
    const same = await escalate('workspace-write', 'workspace-write', true)
    const older = await escalate('workspace-write', 'danger-full-access', true)

    expect(same._tag).toBe('Failure')
    expect(older._tag).toBe('Failure')
    expect(asked).toEqual([])
  })

  test('a mode outside the escalation vocabulary is refused without asking', async () => {
    asked.length = 0
    const observed = await escalate('teleport', 'read-only', true)

    expect(observed._tag).toBe('Failure')
    expect(asked).toEqual([])
  })
})

describe('markers', () => {
  test('the denial names the mode the call ran under', () => {
    expect(sandboxDenialMarker('workspace-write')).toBe(
      '[sandbox: file access denied under workspace-write mode]',
    )
  })

  test('the hint names the retry and who will be asked', () => {
    const hint = escalationHintMarker('command')

    expect(hint).toContain('sandbox_permissions')
    expect(hint).toContain('justification')
    expect(hint).toContain('retry this exact command once')
  })
})
