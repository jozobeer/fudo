import { Effect, Fiber, Queue, Stream } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'
import type { UiCommand } from '@jozo-harness/ui-protocol'
import { createSignal, type Accessor } from 'solid-js'
import { UiRpcs, withoutServices } from '../src/shared/rpc.ts'
import {
  applyUiEvent,
  initialState,
  withConnection,
  withDraft,
  withModels,
  withPane,
  withProblem,
  withRun,
  withSession,
  withSessions,
  withSettings,
  withTheme,
  type Pane,
  type WebState,
} from '../client/state.ts'
import { THEME_KEY, themeAttribute, themeFrom, type Theme } from '../client/theme.ts'
import { makeBridge } from './bridge.ts'

/** The socket the page talks to; the host is the one that served the page. */
export const socketUrl = (protocol: string, host: string): string =>
  (protocol === 'https:' ? 'wss://' : 'ws://') + host + '/ui'

/** Writes the reader's choice where the stylesheet reads it; the system's is its own. */
const applyTheme = (theme: Theme): void => {
  const attribute = themeAttribute(theme)
  if (attribute === undefined) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = attribute
}

/** How one failed call reads in the status strip. */
const messageOf = (error: unknown): string =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)

/** What one session's log told the page to read again. */
const needsRefresh = (type: string): boolean =>
  type === 'turn/end' || type.startsWith('agent/inbox/')

const sessionInUrl = (search: string): string | undefined => {
  const value = new URLSearchParams(search).get('session')
  return value === null || value === '' ? undefined : value
}

/** What the settings pane asked the server for. */
type PanelAsk =
  | { readonly kind: 'models' }
  | { readonly kind: 'setModel'; readonly model: string }
  | { readonly kind: 'job'; readonly id: string }
  | { readonly kind: 'stopJob'; readonly id: string }

/** Everything the components may ask of the session. */
export interface SessionStore {
  readonly state: Accessor<WebState>
  /** Opens the socket and reads the store; call once, when the app mounts. */
  readonly start: () => void
  /** Stops the program, for a page that is going away. */
  readonly stop: () => void
  readonly setDraft: (text: string) => void
  readonly submit: () => void
  readonly send: (command: UiCommand) => void
  readonly moveTo: (id: string | undefined) => void
  readonly chooseTheme: (theme: Theme) => void
  readonly showPane: (pane: Pane | undefined) => void
  readonly openJob: (id: string) => void
  readonly stopJob: (id: string) => void
  readonly askModels: () => void
  readonly setModel: (model: string) => void
}

export interface SessionStoreOptions {
  /** Where the socket lives; the page's own origin when absent. */
  readonly url?: string
  /** The search string the session in the address bar is read from. */
  readonly search?: string
}

export const createSessionStore = (options: SessionStoreOptions = {}): SessionStore => {
  const url = options.url ?? socketUrl(window.location.protocol, window.location.host)
  const search = options.search ?? window.location.search
  const [state, setState] = createSignal<WebState>(initialState)
  const update = (next: (current: WebState) => WebState): void => {
    setState((current) => next(current))
  }

  const commands = Effect.runSync(Queue.unbounded<UiCommand>())
  const moves = Effect.runSync(Queue.unbounded<string | undefined>())
  const panelAsks = Effect.runSync(Queue.unbounded<PanelAsk>())
  let following: Fiber.Fiber<void, unknown> | undefined
  const bridge = makeBridge((message) => update((current) => withProblem(current, message)))

  const program = Effect.gen(function* () {
    const client = yield* RpcClient.make(UiRpcs)

    // The orchestration below mirrors the current page's while both entries are
    // served side by side: the port is compared against it, so the two are not
    // refactored apart. The markers lift the duplication gate for this range.
    /* jscpd:ignore-start */
    // Reads the store and the run state again: a session earns its name as it works.
    const relist = () =>
      Effect.gen(function* () {
        const listed = yield* client.sessions()
        const current = state()
        const running =
          current.sessionId === ''
            ? undefined
            : yield* client.state({ sessionId: current.sessionId })
        yield* Effect.sync(() => {
          update((now) => withSessions(now, listed.items))
          if (running !== undefined) update((now) => withRun(now, running))
        })
      })

    /** Everything one session logs, until the socket or the page moves on. */
    const follow = (id: string) =>
      client.events({ sessionId: id }).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => {
              update((now) => applyUiEvent(now, event))
            })
            if (event.kind === 'session' && needsRefresh(event.event.type)) yield* relist()
          }),
        ),
      )

    const show = (id: string | undefined) =>
      Effect.gen(function* () {
        const summary = yield* client.open(id === undefined ? {} : { sessionId: id })
        if (following !== undefined) yield* Fiber.interrupt(following)
        const running = yield* client.state({ sessionId: summary.id })
        yield* Effect.sync(() => {
          update((now) => withRun(withSession(now, summary), running))
          history.replaceState(null, '', '?session=' + encodeURIComponent(summary.id))
        })
        following = yield* Effect.forkScoped(follow(summary.id))
      })
    /* jscpd:ignore-end */

    yield* Effect.sync(() => {
      update((now) => withConnection(now, true))
    })

    yield* Effect.forkScoped(
      Stream.runForEach(Stream.fromQueue(commands), (command) =>
        client.command({ sessionId: state().sessionId, command }).pipe(Effect.ignore),
      ),
    )
    /** Reads one job and shows it in the pane; stopping it reads it again after. */
    const showJob = (id: string) =>
      Effect.gen(function* () {
        const detail = yield* client.jobDetail({ sessionId: state().sessionId, id })
        yield* Effect.sync(() => update((now) => withPane(now, { kind: 'job', id, detail })))
      })

    yield* Effect.forkScoped(
      Stream.runForEach(Stream.fromQueue(panelAsks), (ask) =>
        Effect.gen(function* () {
          const asked = ask
          if (asked.kind === 'models') {
            const models = yield* client.models()
            yield* Effect.sync(() => update((now) => withModels(now, models)))
            return
          }
          if (asked.kind === 'job') {
            yield* showJob(asked.id)
            return
          }
          if (asked.kind === 'stopJob') {
            yield* client.stopJob({ sessionId: state().sessionId, id: asked.id })
            yield* relist()
            yield* showJob(asked.id)
            return
          }
          yield* client.setModel({ model: asked.model })
          // Read it back, so the pane shows what the file now holds.
          const settings = yield* client.settings()
          yield* Effect.sync(() => update((now) => withSettings(now, settings)))
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => update((now) => withProblem(now, messageOf(error)))),
          ),
        ),
      ),
    )

    const settings = yield* client.settings()
    yield* Effect.sync(() => update((now) => withSettings(now, settings)))

    const listed = yield* client.sessions()
    yield* Effect.sync(() => update((now) => withSessions(now, listed.items)))

    // The session the page opens, then one more for every move: a click, or a new session.
    const current = state()
    const wanted =
      current.sessionId !== '' ? current.sessionId : (sessionInUrl(search) ?? listed.initial)
    yield* Stream.runForEach(
      Stream.concat(Stream.fromIterable([wanted]), Stream.fromQueue(moves)),
      (id) =>
        show(id).pipe(
          Effect.catch((error) =>
            Effect.sync(() => update((now) => withProblem(now, String(error)))),
          ),
        ),
    )
  })

  const runnable = withoutServices(
    program.pipe(
      Effect.ensuring(Effect.sync(() => update((now) => withConnection(now, false)))),
      Effect.provide(RpcClient.layerProtocolSocket()),
      Effect.provide(Socket.layerWebSocket(url)),
      Effect.provide(Socket.layerWebSocketConstructorGlobal),
      Effect.provide(RpcSerialization.layerJson),
      Effect.scoped,
    ),
  )

  const start = (): void => {
    const theme = themeFrom(localStorage.getItem(THEME_KEY))
    update((now) => withTheme(now, theme))
    applyTheme(theme)
    bridge.start(runnable)
  }

  return {
    state,
    start,
    stop: () => bridge.stop(),
    setDraft: (draft) => update((now) => withDraft(now, draft)),
    submit: () => {
      const current = state()
      const value = current.draft.trim()
      if (value === '') return
      const ask = current.conversation.ask
      Queue.offerUnsafe(
        commands,
        ask === undefined
          ? { kind: 'submit', text: value }
          : { kind: 'answer', id: ask.id, answer: value },
      )
      update((now) => withDraft(now, ''))
    },
    send: (command) => Queue.offerUnsafe(commands, command),
    moveTo: (id) => Queue.offerUnsafe(moves, id),
    chooseTheme: (theme) => {
      update((now) => withTheme(now, theme))
      applyTheme(theme)
      localStorage.setItem(THEME_KEY, theme)
    },
    showPane: (pane) => update((now) => withPane(now, pane)),
    openJob: (id) => {
      update((now) => withPane(now, { kind: 'job', id, detail: undefined }))
      Queue.offerUnsafe(panelAsks, { kind: 'job', id })
    },
    stopJob: (id) => Queue.offerUnsafe(panelAsks, { kind: 'stopJob', id }),
    askModels: () => Queue.offerUnsafe(panelAsks, { kind: 'models' }),
    setModel: (model) => Queue.offerUnsafe(panelAsks, { kind: 'setModel', model }),
  }
}
