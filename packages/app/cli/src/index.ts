export * from './args.ts'
export * from './bin.ts'
import { Agents, type Agent } from '@fudo/agent'
import {
  Hooks,
  loadProfile,
  mergeRows,
  parseProfile,
  renderConfig,
  type Plugin,
  type PluginRow,
} from '@fudo/kernel'
import type { SessionId } from '@fudo/session'
import { SystemPrompt, registerAgentsMd } from '@fudo/system-prompt'
import { ToolError } from '@fudo/tools'
import { Tools } from '@fudo/tools'
import { Tier0Tools } from '@fudo/tools-tier0'
import { makeSubagentTool, makeWorkingDirectoryTool, tier1Tools } from '@fudo/tools-tier1'
import {
  Approval,
  Ask,
  approvalServiceLayer,
  askServiceLayer,
  installApproval,
  installAsk,
  installPlanMode,
  Policy,
  type AskRequested,
  type ApprovalRequested,
} from '@fudo/safety'
import { Cause, Context, Effect, Layer, Stream } from 'effect'

export interface CommandOptions {
  /** Profile documents, first layer first (`bundle/base` then the selected profile). */
  readonly profiles: ReadonlyArray<string>
  readonly patches?: ReadonlyArray<string>
  readonly plugins: ReadonlyArray<Plugin<any, any, any>>
  /** One-shot task. Without it the command has nothing to run (the REPL lands later). */
  readonly task?: string
  /** Lines of a REPL session; when absent the command has nothing to run. */
  readonly lines?: Stream.Stream<string>
  /** Completes to request a \`user\` cancellation, as SIGINT does. */
  readonly interrupt?: Effect.Effect<void>
  /** Answers an approval request; the default denies, so nothing hangs unanswered. */
  readonly approve?: (request: ApprovalRequested) => Effect.Effect<boolean>
  /** Answers ask_user questions; without it the question waits for an Ask answer. */
  readonly answer?: (request: AskRequested) => Effect.Effect<string>
  /** Directories searched by the skill tool, in order. */
  readonly skills?: ReadonlyArray<string>
  /** Lets the model run tasks in child agents. */
  readonly subagents?: boolean
  readonly resume?: SessionId
  readonly cwd: string
  /** `provider/model`, taken from the CLI or the profile row. */
  readonly route: string
  readonly dumpConfig?: boolean
  /** Writes session events as JSONL instead of streaming the assistant text. */
  readonly json?: boolean
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

/** Exit codes: completed 0, error 1. SIGINT (130) lands with the signal handling slice. */
const planModeOf = (config: unknown): boolean => isRecord(config) && config.planMode === true

const denyApproval = (_request: ApprovalRequested): Effect.Effect<boolean> => Effect.succeed(false)

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A profile may carry the route on a row's config, as model: provider/model. */
const routeFromRows = (rows: ReadonlyArray<PluginRow>): string => {
  for (const row of rows) {
    if (isRecord(row.config) && typeof row.config.model === 'string' && row.config.model !== '') {
      return row.config.model
    }
  }
  return ''
}

const exitCodeOf = (_cause: Cause.Cause<unknown>): number => 1

/**
 * Runs one `fudo` command over a profile: build the layer, start the agent,
 * wait for the turn, and return the process exit code (0 completed, 1 error).
 */
export function runCommand(options: CommandOptions): Effect.Effect<number> {
  return Effect.gen(function* () {
    const documents: Array<{ readonly plugins: ReadonlyArray<import('@fudo/kernel').PluginRow> }> =
      []
    for (const text of [...options.profiles, ...(options.patches ?? [])]) {
      documents.push(yield* parseProfile(text))
    }
    const rows = mergeRows(documents.map((document) => document.plugins))
    const route = options.route !== '' ? options.route : routeFromRows(rows)

    if (options.dumpConfig === true) {
      options.stdout(renderConfig(rows))
      return 0
    }

    const layer = yield* loadProfile({ plugins: options.plugins, layers: [rows] })
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          Layer.mergeAll(layer, approvalServiceLayer, askServiceLayer),
        )
        const hooks = Context.get(context, Hooks)
        if (options.json === true) {
          yield* hooks.on('session/event', (event) => {
            options.stdout(JSON.stringify(event) + '\n')
          })
        } else {
          yield* hooks.on('agent/assistant-stream', (timed) => {
            if (timed.chunk.type === 'text-delta' && timed.chunk.text !== '')
              options.stdout(timed.chunk.text)
          })
        }

        // Workspace instructions join the prompt before the first turn.
        yield* registerAgentsMd(Context.get(context, SystemPrompt), options.cwd)

        // Plan mode hides every tool that could change the workspace.
        if (rows.some((row) => row.name === '@fudo/safety' && planModeOf(row.config))) {
          yield* installPlanMode(Context.get(context, Tools))
        }

        const agents = Context.get(context, Agents)
        const agent: Agent =
          options.resume === undefined
            ? yield* agents.create({ cwd: options.cwd, options: { route } })
            : yield* agents.create({
                cwd: options.cwd,
                resume: options.resume,
                options: { route },
              })

        // Tools come from the profile's tier rows.
        if (rows.some((row) => row.name === '@fudo/tools-tier0')) {
          const registry = Context.get(context, Tools)
          for (const tool of Context.get(context, Tier0Tools)) yield* registry.register(tool)
        }

        // Tier 1 tools ask the user; their questions and answers join the log.
        if (rows.some((row) => row.name === '@fudo/tools-tier1')) {
          const registry = Context.get(context, Tools)
          const holder = Context.get(context, Ask)
          const answer = options.answer
          const ask = installAsk(
            answer === undefined ? holder : { ...holder, ask: (request) => answer(request) },
            agent.session,
          )
          const list = [...tier1Tools(ask, options.skills ?? [])]
          list.push(
            makeWorkingDirectoryTool({
              root: options.cwd,
              change: (cwd) =>
                agent.session.append('session/cwd/changed', { cwd }).pipe(
                  Effect.mapError(
                    () =>
                      new ToolError({
                        code: 'execution',
                        message: 'cannot record the working directory',
                      }),
                  ),
                ),
            }),
          )
          if (options.subagents === true) {
            list.push(makeSubagentTool(Context.get(context, Agents), route))
          }
          for (const tool of list) yield* registry.register(tool)
        }

        // Approval is enforced only when the profile chose a safety row.
        if (rows.some((row) => row.name === '@fudo/safety')) {
          yield* installApproval(agent.session, options.approve ?? denyApproval).pipe(
            Effect.provideService(Hooks, hooks),
            Effect.provideService(Policy, Context.get(context, Policy)),
            Effect.provideService(Approval, Context.get(context, Approval)),
          )
        }
        if (options.task === undefined) {
          const lines = options.lines
          if (lines === undefined) {
            options.stderr('nothing to do: pass a task or run on a terminal')
            return 2
          }
          yield* Stream.runForEach(lines, (line) =>
            line.trim() === ''
              ? Effect.void
              : Effect.gen(function* () {
                  yield* agent.followup({ text: line, source: 'user' })
                  yield* agent.whenIdle
                }),
          )
          return 0
        }
        yield* agent.followup({ text: options.task, source: 'user' })
        let cancelled = false
        if (options.interrupt !== undefined) {
          const interrupt = options.interrupt
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              yield* interrupt
              cancelled = true
              yield* agent.cancel('user')
            }),
          )
        }
        yield* agent.whenIdle
        return cancelled ? 130 : 0
      }),
    )
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        options.stderr(`fudo: ${Cause.pretty(cause)}\n`)
        return exitCodeOf(cause)
      }),
    ),
  )
}
