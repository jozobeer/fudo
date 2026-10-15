import { Effect } from 'effect'
import type { HookRegistry } from '@jozo-harness/kernel'
import type { Agent } from '@jozo-harness/agent'
import type { SessionEvent } from '@jozo-harness/session'
import type { ToolExecution, ToolExecutionResult } from '@jozo-harness/tools'

/** The consecutive-repeat counts that earn a reminder, gentle first. */
export const REPEAT_THRESHOLDS: ReadonlyArray<number> = [3, 5, 8]
/** How much of the repeated arguments a detailed reminder quotes. */
export const ARGUMENTS_PREVIEW_CHARS = 500

/** The calls that end the log: one tool, one argument string, repeated. */
export interface RepeatRun {
  readonly tool: string
  readonly arguments: string
  readonly count: number
}

/** The trailing run of identical tool calls, or nothing when no call was made. */
export const trailingRepeat = (events: ReadonlyArray<SessionEvent>): RepeatRun | undefined => {
  const calls = events.filter((event) => event.type === 'tool/call')
  const last = calls[calls.length - 1]
  if (last === undefined) return undefined
  let count = 0
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index]
    if (call?.data.name !== last.data.name || call.data.arguments !== last.data.arguments) break
    count += 1
  }
  return { tool: last.data.name, arguments: last.data.arguments, count }
}

/** What a reminder says, and which repeat it answers. */
export interface RepeatReminder {
  readonly count: number
  readonly text: string
}

const preview = (argumentsJson: string): string =>
  argumentsJson.length > ARGUMENTS_PREVIEW_CHARS
    ? argumentsJson.slice(0, ARGUMENTS_PREVIEW_CHARS) + '...'
    : argumentsJson

const reminderText = (run: RepeatRun, gentle: boolean): string =>
  gentle
    ? 'You are repeating the exact same tool call with identical arguments. Read the previous ' +
      'result again before calling it once more: if the work is not done, change the arguments or ' +
      'the approach instead of repeating the call.'
    : 'Repeated tool call detected:\n- tool: ' +
      run.tool +
      '\n- consecutive_calls: ' +
      String(run.count) +
      '\n- arguments: ' +
      preview(run.arguments) +
      '\nChange the arguments or the approach; the same call will keep answering the same way.'

/**
 * The reminder the newest call earns, if any. The run length is read from the log,
 * so a resumed session counts the same way, and a count is reached once per run:
 * the third, fifth, and eighth identical call each speak exactly once.
 */
export const repeatReminder = (events: ReadonlyArray<SessionEvent>): RepeatReminder | undefined => {
  const run = trailingRepeat(events)
  if (run === undefined) return undefined
  if (!REPEAT_THRESHOLDS.includes(run.count)) return undefined
  return { count: run.count, text: reminderText(run, run.count === REPEAT_THRESHOLDS[0]) }
}

/**
 * Appends the repeat reminder to the result of the call that earned it, so the
 * model reads it in the same breath as the result and the log keeps it. Only the
 * agent's own calls are read: a child's repeats are not this session's story.
 */
export const installRepeatReminders = (
  agent: Agent,
  hooks: HookRegistry,
): Effect.Effect<void, never, import('effect').Scope.Scope> =>
  hooks.on(
    'tools/post-execute',
    (
      exec: ToolExecution,
      result: ToolExecutionResult,
      next: () => Effect.Effect<ToolExecutionResult>,
    ) =>
      Effect.gen(function* () {
        // Run first and let the other listeners decide, then add to what they
        // produced rather than replacing it: a reminder must not take their work away.
        const posted = (yield* next()) ?? result
        if (exec.context.sessionId !== agent.id) return posted
        const reminder = repeatReminder(agent.session.events())
        if (reminder === undefined) return posted
        return {
          ...posted,
          content: [...posted.content, { type: 'text' as const, text: '\n' + reminder.text }],
        }
      }),
    { prepend: true },
  )
