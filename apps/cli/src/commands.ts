import { Effect } from 'effect'
import {
  commandHelp,
  cwdOf,
  type CommandsShape,
  type Session,
  type SessionHeader,
} from '@jozo-harness/session'
import { currentGoal, currentSchedules, goalRounds, ruleText } from '@jozo-harness/tools-tier1'

/** The model the last request went to, as the log recorded it. */
const modelOf = (session: Session): string => {
  const events = session.events()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'request/header') return event.data.provider + '/' + event.data.model
  }
  return 'unknown'
}

const goalLine = (session: Session): string => {
  const goal = currentGoal(session.events())
  if (goal === undefined) return 'goal: none'
  const rounds = goalRounds(session.events())
  return (
    'goal: ' +
    goal.phase +
    ' ' +
    String(rounds) +
    '/' +
    String(goal.maxGoalRounds) +
    ' — ' +
    goal.objective
  )
}

const scheduleLines = (session: Session): ReadonlyArray<string> => {
  const schedules = currentSchedules(session.events())
  if (schedules.length === 0) return ['schedules: none']
  return [
    'schedules: ' + String(schedules.length),
    ...schedules.map((schedule) => '  ' + schedule.id + ' ' + ruleText(schedule.rule)),
  ]
}

/** What /status answers: everything a session can say about itself from its log. */
export const statusText = (session: Session): string => {
  const events = session.events()
  const header: SessionHeader = session.header
  return [
    'session: ' + session.id,
    'model: ' + modelOf(session),
    'cwd: ' + cwdOf(events, header),
    'turns: ' + String(events.filter((event) => event.type === 'turn/start').length),
    goalLine(session),
    ...scheduleLines(session),
  ].join('\n')
}

/** The commands every jozo-harness session answers. Both only read the log. */
export const installBuiltinCommands = (commands: CommandsShape): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* commands.register({
      name: 'help',
      summary: 'list the commands this session answers',
      run: () => Effect.succeed({ ok: true, text: commandHelp(commands.list()) }),
    })
    yield* commands.register({
      name: 'status',
      summary: 'where this session stands: model, cwd, turns, goal, schedules',
      run: (_input, context) => Effect.succeed({ ok: true, text: statusText(context.session) }),
    })
    // Two commands with these names would be a mistake in this file, not a session's.
  }).pipe(Effect.orDie)
