export * from './args.ts'
export * from './bin.ts'
import { Agents, type Agent, type AgentOptions, type AgentsShape } from '@fudo/agent'
import {
  Hooks,
  loadProfile,
  mergeRows,
  parseProfile,
  renderConfig,
  renderPluginKeys,
  type HookRegistry,
  type Plugin,
  type PluginError,
  type PluginRow,
} from '@fudo/kernel'
import type { SessionId } from '@fudo/session'
import { SystemPrompt, registerAgentsMd } from '@fudo/system-prompt'
import { ToolError } from '@fudo/tools'
import { Tools, type ToolDefinition, type ToolRegistry } from '@fudo/tools'
import { Tier0Tools } from '@fudo/tools-tier0'
import {
  jobTools,
  makeJobs,
  mcpTools,
  McpServers,
  startMcpServer,
  makeWebSearchTool,
  type JobsShape,
  type McpServerConfig,
  type SearchHost,
  makeSubagentTool,
  makeWorkingDirectoryTool,
  tier1Tools,
} from '@fudo/tools-tier1'
import {
  Approval,
  Ask,
  approvalServiceLayer,
  askServiceLayer,
  installApproval,
  installAsk,
  installPlanMode,
  Policy,
  type ApprovalRequested,
  type ApprovalShape,
  type AskRequested,
  type AskShape,
  type PolicyShape,
} from '@fudo/safety'
import { join } from 'node:path'
import { runTui, type TuiIo } from '@fudo/tui'
import { makeUiHost, type UiHost } from '@fudo/ui-host'
import { defaultStaticRoot, serveWeb } from '@fudo/web'
import { Cause, Context, Effect, Layer, Scope, Stream } from 'effect'
import {
  MODEL_KEY,
  PLAN_MODE_KEY,
  SPILL_BYTES_KEY,
  renderModelInEffect,
  renderSurface,
} from './surface.ts'
import type { FudoConfig } from './config-file.ts'

export interface CommandOptions {
  /** Profile documents, first layer first (`bundle/base` then the selected profile). */
  readonly profiles: ReadonlyArray<string>
  /** Rows from the settings file; patches still win over them. */
  readonly extraRows?: ReadonlyArray<PluginRow>
  readonly patches?: ReadonlyArray<string>
  readonly plugins: ReadonlyArray<Plugin<any, any, any>>
  /** The settings file the command read; without one the dump names the default. */
  readonly settingsPath?: string
  /** What that file held, so the dump can show the state. */
  readonly settings?: FudoConfig
  /** One-shot task. */
  readonly task?: string
  /** Lines of a batch session, used when stdin is not a terminal. */
  readonly lines?: Stream.Stream<string>
  /** When present, the command serves the interactive terminal UI. */
  readonly tui?: TuiIo
  /** When present, the command serves the browser UI on that port (0 picks one). */
  readonly web?: { readonly port: number }
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
  /** A search provider; without one the web_search tool is not registered. */
  readonly search?: SearchHost
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
const spillBytesOf = (rows: ReadonlyArray<PluginRow>): number | undefined => {
  for (const row of rows) {
    if (isRecord(row.config) && typeof row.config[SPILL_BYTES_KEY] === 'number') {
      return row.config[SPILL_BYTES_KEY]
    }
  }
  return undefined
}

/** The failure of the newest turn, when it ended in an error. */
const turnFailure = (agent: Agent): string | undefined => {
  const events = agent.session.events()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'turn/end') continue
    const reason = event.data.reason
    if (reason.kind === 'error') {
      return reason.failure.code + ': ' + reason.failure.message
    }
    return undefined
  }
  return undefined
}

const planModeOf = (config: unknown): boolean => isRecord(config) && config[PLAN_MODE_KEY] === true

const denyApproval = (_request: ApprovalRequested): Effect.Effect<boolean> => Effect.succeed(false)

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A profile may carry the route on a row's config, as model: provider/model. */
const routeFromRows = (rows: ReadonlyArray<PluginRow>): string => {
  for (const row of rows) {
    const route = isRecord(row.config) ? row.config[MODEL_KEY] : undefined
    if (typeof route === 'string' && route !== '') return route
  }
  return ''
}

const NO_MODEL =
  'no model is set: pass --model provider/model or set model in the settings file (fudo models lists them)'

const exitCodeOf = (_cause: Cause.Cause<unknown>): number => 1

/** The rows the command runs with: profiles first, then settings, then patches. */
export const profileRows = (
  options: Pick<CommandOptions, 'profiles' | 'extraRows' | 'patches'>,
): Effect.Effect<ReadonlyArray<PluginRow>, PluginError> =>
  Effect.gen(function* () {
    const layers: Array<ReadonlyArray<PluginRow>> = []
    for (const text of options.profiles) {
      layers.push((yield* parseProfile(text)).plugins)
    }
    if (options.extraRows !== undefined) layers.push(options.extraRows)
    for (const text of options.patches ?? []) {
      layers.push((yield* parseProfile(text)).plugins)
    }
    return mergeRows(layers)
  })

const hasRow = (rows: ReadonlyArray<PluginRow>, name: string): boolean =>
  rows.some((row) => row.name === name)

/** Streams assistant text unless the caller asked for JSON session events. */
const installOutput = (hooks: HookRegistry, options: CommandOptions) =>
  Effect.gen(function* () {
    if (options.json === true) {
      yield* hooks.on('session/event', (event) => {
        options.stdout(JSON.stringify(event) + '\n')
      })
      return
    }
    yield* hooks.on('agent/assistant-stream', (timed) => {
      if (timed.chunk.type === 'text-delta' && timed.chunk.text !== '')
        options.stdout(timed.chunk.text)
    })
  })

/** MCP servers bring their own tools; the caller owns their processes. */
const installMcpServers = (tools: ToolRegistry, servers: ReadonlyArray<McpServerConfig>) =>
  Effect.gen(function* () {
    for (const server of servers) {
      const client = yield* startMcpServer({ command: server.command })
      for (const tool of yield* mcpTools(client, server.prefix ?? 'mcp__')) {
        yield* tools.register(tool)
      }
    }
  })

const installTier0 = (tools: ToolRegistry, tier0: ReadonlyArray<ToolDefinition<any, any>>) =>
  Effect.gen(function* () {
    for (const tool of tier0) yield* tools.register(tool)
  })

/** Tier 1 tools ask the user; their questions and answers join the log. */
const installTier1 = (
  tools: ToolRegistry,
  holder: AskShape,
  agents: AgentsShape,
  options: CommandOptions,
  agent: Agent,
  route: string,
  answer: CommandOptions['answer'],
) =>
  Effect.gen(function* () {
    const ask = installAsk(
      answer === undefined ? holder : { ...holder, ask: (request) => answer(request) },
      agent.session,
    )
    const jobs = yield* makeJobs()
    for (const tool of tier1ToolList(ask, options, agent, route, agents, jobs)) {
      yield* tools.register(tool)
    }
  })

const tier1ToolList = (
  ask: AskShape,
  options: CommandOptions,
  agent: Agent,
  route: string,
  agents: AgentsShape,
  jobs: JobsShape,
) => {
  const list = [...tier1Tools(ask, options.skills ?? [])]
  if (options.search !== undefined) list.push(makeWebSearchTool(options.search))
  for (const tool of jobTools(jobs)) list.push(tool)
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
    list.push(
      makeSubagentTool({
        agents,
        route,
        parentEvents: () => agent.session.events(),
      }),
    )
  }
  return list
}

/** Approval is enforced only when the profile chose a safety row. */
const installSafety = (
  agent: Agent,
  approve: CommandOptions['approve'],
  hooks: HookRegistry,
  policy: PolicyShape,
  approval: ApprovalShape,
) =>
  installApproval(agent.session, approve ?? denyApproval).pipe(
    Effect.provideService(Hooks, hooks),
    Effect.provideService(Policy, policy),
    Effect.provideService(Approval, approval),
  )

const createAgent = (
  agents: AgentsShape,
  options: CommandOptions,
  route: string,
  spillBytes: number | undefined,
) =>
  Effect.gen(function* () {
    const agentOptions: AgentOptions = {
      route,
      ...(spillBytes === undefined ? {} : { maxSpillBytes: spillBytes }),
    }
    return options.resume === undefined
      ? yield* agents.create({ cwd: options.cwd, options: agentOptions })
      : yield* agents.create({ cwd: options.cwd, resume: options.resume, options: agentOptions })
  })

const serveLines = (agent: Agent, options: CommandOptions, lines: Stream.Stream<string>) =>
  Effect.gen(function* () {
    yield* Stream.runForEach(lines, (line) =>
      line.trim() === ''
        ? Effect.void
        : Effect.gen(function* () {
            yield* agent.followup({ text: line, source: 'user' })
            yield* agent.whenIdle
          }),
    )
    const failure = turnFailure(agent)
    if (failure !== undefined) {
      options.stderr('fudo: a turn failed: ' + failure + '\n')
      return 1
    }
    return 0
  })

const serveTask = (agent: Agent, options: CommandOptions, task: string) =>
  Effect.gen(function* () {
    yield* agent.followup({ text: task, source: 'user' })
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
    const failure = turnFailure(agent)
    if (failure !== undefined) {
      options.stderr('fudo: the turn failed: ' + failure + '\n')
      return 1
    }
    return cancelled ? 130 : 0
  })

/** What one run serves: a task, a batch of lines, or one of the UIs. */
type Work =
  | { readonly kind: 'task'; readonly task: string }
  | { readonly kind: 'lines'; readonly lines: Stream.Stream<string> }
  | { readonly kind: 'tui'; readonly io: TuiIo }
  | { readonly kind: 'web'; readonly port: number }

const workOf = (options: CommandOptions): Work | undefined => {
  if (options.task !== undefined) return { kind: 'task', task: options.task }
  if (options.web !== undefined) return { kind: 'web', port: options.web.port }
  if (options.tui !== undefined) return { kind: 'tui', io: options.tui }
  if (options.lines !== undefined) return { kind: 'lines', lines: options.lines }
  return undefined
}

const serveAgent = (agent: Agent, options: CommandOptions, work: Work) =>
  work.kind === 'task'
    ? serveTask(agent, options, work.task)
    : work.kind === 'lines'
      ? serveLines(agent, options, work.lines)
      : Effect.succeed(0)

/** Everything the profile's rows install on one running agent. */
interface ProfileWiring {
  readonly rows: ReadonlyArray<PluginRow>
  readonly options: CommandOptions
  readonly route: string
  readonly agent: Agent
  readonly answer: CommandOptions['answer']
  readonly approve: CommandOptions['approve']
  readonly hooks: HookRegistry
  /** Read only inside a branch: an absent row means the service was never built. */
  readonly context: Context.Context<any>
}

/** Tiers and guards come from the profile's rows. */
const installFromProfile = (wiring: ProfileWiring): Effect.Effect<void, ToolError, Scope.Scope> =>
  Effect.gen(function* () {
    const tools = Context.get(wiring.context, Tools)
    if (hasRow(wiring.rows, '@fudo/tools-tier0')) {
      yield* installTier0(tools, Context.get(wiring.context, Tier0Tools))
    }
    if (hasRow(wiring.rows, '@fudo/tools-tier1')) {
      yield* installTier1(
        tools,
        Context.get(wiring.context, Ask),
        Context.get(wiring.context, Agents),
        wiring.options,
        wiring.agent,
        wiring.route,
        wiring.answer,
      )
    }
    // Plan mode hides every tool that could change the workspace.
    if (wiring.rows.some((row) => row.name === '@fudo/safety' && planModeOf(row.config))) {
      yield* installPlanMode(tools)
    }
    if (hasRow(wiring.rows, '@fudo/safety')) {
      yield* installSafety(
        wiring.agent,
        wiring.approve,
        wiring.hooks,
        Context.get(wiring.context, Policy),
        Context.get(wiring.context, Approval),
      )
    }
  })

/** A UI runs the session itself instead of streaming into the caller's terminal. */
const ownsTheScreen = (work: Work): boolean => work.kind === 'tui' || work.kind === 'web'

const uiHostOf = (
  work: Work,
  agent: Agent,
  hooks: HookRegistry,
): Effect.Effect<UiHost | undefined, never, Scope.Scope> =>
  ownsTheScreen(work)
    ? makeUiHost({ session: agent.session, agent, hooks })
    : Effect.succeed(undefined)

/** Starts the browser UI; it runs until interrupted. */
const serveWebUi = (options: CommandOptions, ui: UiHost, port: number): Effect.Effect<number> =>
  Effect.gen(function* () {
    const index = Bun.file(join(defaultStaticRoot, 'index.html'))
    if (!(yield* Effect.promise(() => index.exists()))) {
      options.stderr('fudo web: the browser app is not built: run bun run build:web\n')
      return 1
    }
    return yield* serveWeb({
      host: ui,
      port,
      staticRoot: defaultStaticRoot,
      onReady: (url) => {
        options.stderr('fudo web: ' + url + '\n')
      },
      ...(options.interrupt === undefined ? {} : { interrupt: options.interrupt }),
    })
  })

/** The UI a work kind asks for, when the caller supplied one. */
const serveUi = (
  options: CommandOptions,
  ui: UiHost | undefined,
  work: Work,
  route: string,
  agent: Agent,
): Effect.Effect<number> | undefined => {
  if (ui === undefined) return undefined
  if (work.kind === 'tui') {
    return runTui(ui, work.io, {
      title: 'fudo · ' + route + ' · ' + agent.id.slice(0, 8),
      ...(options.interrupt === undefined ? {} : { interrupt: options.interrupt }),
    })
  }
  if (work.kind === 'web') return serveWebUi(options, ui, work.port)
  return undefined
}

/** A UI answers approvals and questions through its host; a caller through its own hook. */
const answerersOf = (
  ui: UiHost | undefined,
  options: CommandOptions,
): Pick<ProfileWiring, 'answer' | 'approve'> => ({
  answer: ui === undefined ? options.answer : ui.answerAsk,
  approve: ui === undefined ? options.approve : ui.answerApproval,
})

/** The scoped body that owns the built layer and serves one agent run. */
const runSession = (
  options: CommandOptions,
  rows: ReadonlyArray<PluginRow>,
  route: string,
  spillBytes: number | undefined,
  layer: Layer.Layer<any, PluginError, never>,
  work: Work,
) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(Layer.mergeAll(layer, approvalServiceLayer, askServiceLayer))
    const hooks = Context.get(context, Hooks)
    // A UI owns the screen; only the non-interactive paths stream text out.
    if (!ownsTheScreen(work)) yield* installOutput(hooks, options)

    // Workspace instructions join the prompt before the first turn.
    yield* registerAgentsMd(Context.get(context, SystemPrompt), options.cwd)

    if (hasRow(rows, '@fudo/mcp')) {
      yield* installMcpServers(Context.get(context, Tools), Context.get(context, McpServers))
    }

    const agent = yield* createAgent(Context.get(context, Agents), options, route, spillBytes)
    const ui = yield* uiHostOf(work, agent, hooks)

    yield* installFromProfile({
      rows,
      options,
      route,
      agent,
      hooks,
      ...answerersOf(ui, options),
      context,
    })

    const served = serveUi(options, ui, work, route, agent)
    if (served !== undefined) return yield* served
    return yield* serveAgent(agent, options, work)
  })

/**
 * Runs one `fudo` command over a profile: build the layer, start the agent,
 * wait for the turn, and return the process exit code (0 completed, 1 error).
 */
export function runCommand(options: CommandOptions): Effect.Effect<number> {
  return Effect.gen(function* () {
    const rows = yield* profileRows(options)
    const route = options.route !== '' ? options.route : routeFromRows(rows)

    if (options.dumpConfig === true) {
      const text =
        renderModelInEffect(route) +
        renderConfig(rows) +
        renderPluginKeys(options.plugins) +
        renderSurface(options.settingsPath, options.settings)
      options.stdout(text)
      return 0
    }

    const work = workOf(options)
    if (work === undefined) {
      options.stderr('nothing to do: pass a task or run on a terminal')
      return 2
    }

    if (route === '') {
      options.stderr(`fudo: ${NO_MODEL}\n`)
      return 1
    }
    const layer = yield* loadProfile({ plugins: options.plugins, layers: [rows] })
    const spillBytes = spillBytesOf(rows)
    return yield* Effect.scoped(runSession(options, rows, route, spillBytes, layer, work))
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        options.stderr(`fudo: ${Cause.pretty(cause)}\n`)
        return exitCodeOf(cause)
      }),
    ),
  )
}
export * from './search-env.ts'
export * from './surface.ts'
export * from './env-file.ts'
export * from './config.ts'
export * from './secrets-file.ts'
export * from './auth.ts'
export * from './auth-cli.ts'
export * from './providers.ts'
export * from './config-file.ts'
