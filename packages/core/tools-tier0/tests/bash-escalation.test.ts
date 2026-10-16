import { HooksLive } from '@jozo-harness/kernel'
import {
  makeApproval,
  noneSandbox,
  type ApprovalRequested,
  type ApprovalShape,
  type SandboxMode,
  type SandboxShape,
} from '@jozo-harness/safety'
import {
  Tools,
  toolsLayer,
  type ToolDefinition,
  type ToolError,
  type ToolExecutionResult,
} from '@jozo-harness/tools'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { makeBashTool } from '../src/index.ts'

const call = (
  tool: ToolDefinition<any, any>,
  args: unknown,
  cwd = '/tmp',
): Effect.Effect<ToolExecutionResult | undefined, ToolError, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(Layer.provideMerge(toolsLayer, HooksLive))
      const tools = Context.get(context, Tools)
      yield* tools.register(tool)
      return yield* tools.call({
        callId: 'c1',
        tool: tool.name,
        arguments: JSON.stringify(args),
        context: { sessionId: 's1', cwd, callId: 'c1' },
      })
    }),
  )

const textOf = (result: ToolExecutionResult | undefined): string =>
  (result?.content ?? []).flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')

/**
 * A sandbox that refuses what a command writes, the way seatbelt does: a denied
 * effect prints the kernel's words and exits non-zero. A wider mode runs the
 * command as it is, which is what an unconfined provider does.
 */
const confining = (standing: SandboxMode = 'workspace-write'): SandboxShape => ({
  name: 'test-confine',
  confines: true,
  mode: standing,
  wrap: (command) => {
    const mode = command.mode ?? standing
    if (mode !== standing) {
      return Effect.succeed({ argv: command.argv, cwd: command.cwd, mode, denialSignatures: [] })
    }
    return Effect.succeed({
      argv: [
        'bash',
        '-lc',
        'printf "%s\\n" "bash: /etc/hosts: Operation not permitted" >&2; exit 1',
      ],
      cwd: command.cwd,
      mode,
      denialSignatures: ['operation not permitted'],
    })
  },
})

/** An approval seam that answers `approved` and records what it was asked. */
const answering = async (approved: boolean): Promise<[ApprovalShape, Array<ApprovalRequested>]> => {
  const asked: Array<ApprovalRequested> = []
  const approval = await Effect.runPromise(makeApproval())
  await Effect.runPromise(
    approval.serve((request) =>
      Effect.sync(() => {
        asked.push(request)
        return approved
      }),
    ),
  )
  return [approval, asked]
}

describe('bash escalation', () => {
  test('a denial says which mode denied it and how a retry is asked for', async () => {
    const [approval] = await answering(false)
    const result = await Effect.runPromise(
      call(makeBashTool(confining(), approval), { command: 'echo hi > /etc/hosts' }),
    )

    const text = textOf(result)
    expect(result?.isError).toBe(false)
    expect(text).toContain('[sandbox: file access denied under workspace-write mode]')
    expect(text).toContain('sandbox_permissions')
    expect(text).toContain('justification')
  })

  test('an approved escalation runs the command under the wider mode', async () => {
    const [approval, asked] = await answering(true)
    const result = await Effect.runPromise(
      call(makeBashTool(confining(), approval), {
        command: 'echo escalated ok',
        sandbox_permissions: 'danger-full-access',
        justification: 'the build writes outside the workspace',
      }),
    )

    expect(result?.isError).toBe(false)
    expect(textOf(result)).toContain('escalated ok')
    expect(asked).toHaveLength(1)
    expect(asked[0]?.tool).toBe('bash')
    expect(asked[0]?.reason).toContain('danger-full-access')
    expect(asked[0]?.reason).toContain('the build writes outside the workspace')
  })

  test('a refused escalation keeps the call denied and never runs the command', async () => {
    const [approval, asked] = await answering(false)
    const result = await Effect.runPromise(
      call(makeBashTool(confining(), approval), {
        command: 'echo escalated ok',
        sandbox_permissions: 'danger-full-access',
        justification: 'the build writes outside the workspace',
      }),
    )

    expect(result?.isError).toBe(true)
    expect(textOf(result)).toContain('rejected')
    expect(textOf(result)).not.toContain('escalated ok')
    expect(asked).toHaveLength(1)
  })

  test('the mode and its reason travel together', async () => {
    const [approval, asked] = await answering(true)
    const result = await Effect.runPromise(
      call(makeBashTool(confining(), approval), {
        command: 'echo hi',
        sandbox_permissions: 'danger-full-access',
      }),
    )

    expect(result?.isError).toBe(true)
    expect(textOf(result)).toContain('justification')
    expect(asked).toEqual([])
  })

  test('a mode that is not wider than the standing one is refused without asking', async () => {
    const [approval, asked] = await answering(true)
    const result = await Effect.runPromise(
      call(makeBashTool(confining('danger-full-access'), approval), {
        command: 'echo hi',
        sandbox_permissions: 'workspace-write',
        justification: 'a narrower mode is not an escalation',
      }),
    )

    expect(result?.isError).toBe(true)
    expect(asked).toEqual([])
  })

  test('nothing confines, so there is nothing to escalate and the schema still says so', async () => {
    const [approval] = await answering(true)
    const tool = makeBashTool(noneSandbox, approval)
    const result = await Effect.runPromise(
      call(tool, {
        command: 'echo hi',
        sandbox_permissions: 'workspace-write',
        justification: 'there is no boundary to leave',
      }),
    )

    expect(result?.isError).toBe(true)
    expect(textOf(result)).toContain('confines')
    expect(tool.parameters).toBeDefined()
  })
})
