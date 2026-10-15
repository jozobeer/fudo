import type { Agent } from '@jozo-harness/agent'
import { Hooks, HooksLive } from '@jozo-harness/kernel'
import type { SessionEvent } from '@jozo-harness/session'
import type { ToolExecution, ToolExecutionResult } from '@jozo-harness/tools'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import {
  installRepeatReminders,
  repeatReminder,
  REPEAT_THRESHOLDS,
  trailingRepeat,
} from '../src/index.ts'

const event = (seq: number, type: string, data: unknown): SessionEvent =>
  ({ seq, time: seq, type, data }) as unknown as SessionEvent

const call = (seq: number, name: string, args: unknown): SessionEvent =>
  event(seq, 'tool/call', { callId: 'c' + String(seq), name, arguments: JSON.stringify(args) })

const result = (seq: number): SessionEvent =>
  event(seq, 'tool/result', { callId: 'c' + String(seq), isError: false, content: [] })

const repeated = (times: number, args: unknown = {}): Array<SessionEvent> => {
  const events: Array<SessionEvent> = []
  for (let index = 0; index < times; index += 1) {
    events.push(call(index * 2 + 1, 'glob', args))
    if (index < times - 1) events.push(result(index * 2 + 2))
  }
  return events
}

describe('the trailing run of identical calls', () => {
  test('counts back from the newest call, results in between and all', () => {
    const events = [
      call(1, 'read', { path: 'a' }),
      result(2),
      call(3, 'glob', { pattern: '*.ts' }),
      result(4),
      call(5, 'glob', { pattern: '*.ts' }),
      result(6),
      call(7, 'glob', { pattern: '*.ts' }),
    ]

    expect(trailingRepeat(events)).toEqual({
      tool: 'glob',
      arguments: '{"pattern":"*.ts"}',
      count: 3,
    })
    expect(trailingRepeat([])).toBeUndefined()
  })

  test('a different call ends the run', () => {
    expect(
      trailingRepeat([call(1, 'glob', {}), call(2, 'glob', {}), call(3, 'read', {})])?.count,
    ).toBe(1)
  })
})

describe('when a reminder is owed', () => {
  test('nothing before the first threshold, gentle at three, detailed later', () => {
    expect(repeatReminder(repeated(2))).toBeUndefined()

    const first = repeatReminder(repeated(3))
    expect(first?.count).toBe(3)
    expect(first?.text).toContain('repeating the exact same tool call')

    const second = repeatReminder(repeated(5))
    expect(second?.count).toBe(5)
    expect(second?.text).toContain('Repeated tool call detected')
    expect(second?.text).toContain('consecutive_calls: 5')
  })

  test('a count between the thresholds says nothing', () => {
    expect(repeatReminder(repeated(4))).toBeUndefined()
    expect(repeatReminder(repeated(6))).toBeUndefined()
    expect(repeatReminder(repeated(8))?.count).toBe(8)
  })

  test('thresholds are the three the policy names', () => {
    expect(REPEAT_THRESHOLDS).toEqual([3, 5, 8])
  })
})

describe('the reminder through the tool pipeline', () => {
  const agent = (sessionId: string, events: ReadonlyArray<SessionEvent>): Agent =>
    ({ id: sessionId, session: { events: () => events } }) as unknown as Agent

  const exec = (sessionId: string): ToolExecution =>
    ({
      name: 'glob',
      arguments: '{}',
      context: { sessionId, cwd: '/work', callId: 'c1' },
    }) as unknown as ToolExecution

  const runHook = async (tools: ReadonlyArray<Agent>, sessionId: string) => {
    const result: ToolExecutionResult = { isError: false, content: [{ type: 'text', text: 'ok' }] }
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(HooksLive)
          const hooks = Context.get(context, Hooks)
          for (const each of tools) yield* installRepeatReminders(each, hooks)
          return yield* hooks.waterfall('tools/post-execute', exec(sessionId), result)
        }),
      ),
    ) as Promise<ToolExecutionResult>
  }

  test('the third identical call carries the reminder in its own result', async () => {
    const posted = await runHook([agent('s1', repeated(3))], 's1')

    expect(posted.content.map((block) => (block.type === 'text' ? block.text : ''))).toEqual([
      'ok',
      '\nYou are repeating the exact same tool call with identical arguments. Read the previous ' +
        'result again before calling it once more: if the work is not done, change the arguments or ' +
        'the approach instead of repeating the call.',
    ])
  })

  test('another session is left alone, and so is a first call', async () => {
    const other = await runHook([agent('s1', repeated(3))], 's2')
    const once = await runHook([agent('s1', repeated(1))], 's1')

    expect(other.content).toEqual([{ type: 'text', text: 'ok' }])
    expect(once.content).toEqual([{ type: 'text', text: 'ok' }])
  })
})
