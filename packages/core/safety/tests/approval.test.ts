import { describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import { makeApproval, type ApprovalRequested } from '../src/index.ts'

const request = (callId: string): ApprovalRequested => ({
  callId,
  tool: 'bash',
  reason: 'escalate to danger-full-access: the build writes outside the workspace',
})

describe('makeApproval', () => {
  test('a request nobody answers is refused at once', async () => {
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        const approval = yield* makeApproval()
        return { served: approval.served(), answer: yield* approval.request(request('c1')) }
      }),
    )

    expect(observed).toEqual({ served: false, answer: false })
  })

  test('the served answerer decides the request, and stopping refuses again', async () => {
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        const approval = yield* makeApproval()
        const seen: Array<ApprovalRequested> = []
        yield* approval.serve((asked) =>
          Effect.sync(() => {
            seen.push(asked)
            return asked.callId === 'c2'
          }),
        )
        const served = approval.served()
        const first = yield* approval.request(request('c1'))
        const second = yield* approval.request(request('c2'))
        yield* approval.stopServing()
        const after = yield* approval.request(request('c3'))
        return { served, first, second, after, seen: seen.map((asked) => asked.callId) }
      }),
    )

    expect(observed).toEqual({
      served: true,
      first: false,
      second: true,
      after: false,
      seen: ['c1', 'c2'],
    })
  })

  test('an answerer that fails refuses the call instead of breaking it', async () => {
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        const approval = yield* makeApproval()
        yield* approval.serve(() => Effect.fail(new Error('the answerer broke')))
        return yield* approval.request(request('c1'))
      }),
    )

    expect(observed).toBe(false)
  })
})
