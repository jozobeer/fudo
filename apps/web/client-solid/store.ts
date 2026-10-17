import { Cause, Effect, Fiber, Queue, Stream } from 'effect'
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
} from '../src/ui/state.ts'
import type { Theme } from '../src/ui/theme.ts'
import { addressSession, keptTheme, keepTheme, pageSearch, pageSocket, showTheme } from './dom.ts'
import { emptyWatched, watchedAfter, type Watched } from '../src/ui/board.ts'
import { makeBridge } from './bridge.ts'

/** How one failed call reads in the status strip. */
const messageOf = (error: unknown): string =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)

/** The one line a whole cause reads as, defects included. */
const causeText = (cause: Cause.Cause<unknown>): string => messageOf(Cause.squash(cause))

/** How long a pipeline the page cannot lose waits before it runs again. */
const RESTART_DELAY = '250 millis'

/** A cause that is only an interruption is the page moving on, not a failure. */
const unlessInterrupted = (
  cause: Cause.Cause<unknown>,
  onFailure: Effect.Effect<void>,
): Effect.Effect<void> => (Cause.hasInterruptsOnly(cause) ? Effect.interrupt : onFailure)

/**
 * Runs one pipeline that must outlive a failure: it is reported and started
 * again. A subscription the page dropped otherwise takes the page down with it
 * in silence, which reads as input that does nothing.
 */
const keepsRunning = <A>(
  what: string,
  effect: Effect.Effect<A, unknown, unknown>,
  report: (message: string) => void,
): Effect.Effect<never, never, unknown> =>
  effect.pipe(
    Effect.catchCause((cause) =>
      unlessInterrupted(
        cause,
        Effect.sync(() => report(what + ': ' + causeText(cause))),
      ),
    ),
    Effect.andThen(Effect.sleep(RESTART_DELAY)),
    Effect.forever,
  )

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
  /** Every session the server has open, followed live, by id. */
  readonly watched: Accessor<ReadonlyMap<string, Watched>>
  /** Opens the socket and reads the store; call once, when the app mounts. */
  readonly start: () => void
  /** Stops the program, for a page that is going away. */
  readonly stop: () => void
  readonly setDraft: (text: string) => void
  readonly submit: () => void
  readonly send: (command: UiCommand) => void
  /** Sends one command to a session that need not be the one on screen. */
  readonly sendTo: (sessionId: string, command: UiCommand) => void
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
  const url = options.url ?? pageSocket()
  const search = options.search ?? pageSearch()
  const [state, setState] = createSignal<WebState>(initialState)
  const update = (next: (current: WebState) => WebState): void => {
    setState((current) => next(current))
  }

  const [watched, setWatched] = createSignal<ReadonlyMap<string, Watched>>(new Map())
  const commands = Effect.runSync(
    Queue.unbounded<{ readonly sessionId: string; readonly command: UiCommand }>(),
  )
  const moves = Effect.runSync(Queue.unbounded<string | undefined>())
  const panelAsks = Effect.runSync(Queue.unbounded<PanelAsk>())
  let following: Fiber.Fiber<void, unknown> | undefined
  const bridge = makeBridge((message) => update((current) => withProblem(current, message)))

  const program = Effect.gen(function* () {
    const client = yield* RpcClient.make(UiRpcs)
    /** The sessions this connection follows for the board; a dropped stream may follow again. */
    const watching = new Set<string>()

    const watch = (id: string) =>
      Effect.suspend(() => {
        if (watching.has(id)) return Effect.void
        watching.add(id)
        return Effect.forkScoped(
          client.events({ sessionId: id }).pipe(
            Stream.runForEach((event) =>
              Effect.sync(() =>
                setWatched((now) =>
                  new Map(now).set(id, watchedAfter(now.get(id) ?? emptyWatched, event)),
                ),
              ),
            ),
            // A row that stops moving is not worth the reader's attention: the
            // board follows the session again without saying anything about it.
            Effect.catchCause((cause) => unlessInterrupted(cause, Effect.void)),
            Effect.andThen(Effect.sleep(RESTART_DELAY)),
            Effect.forever,
            // The claim on the id stands for the whole life of this fiber, so a
            // second look at the same session does not open a second stream.
            Effect.ensuring(Effect.sync(() => watching.delete(id))),
          ),
        ).pipe(Effect.asVoid)
      })

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
        yield* Effect.forEach(listed.opened, watch)
      })

    /**
     * Everything one session logs, until the page moves on. A dropped
     * subscription follows again: the server opens with the session's history,
     * and the fold keeps only the events past the last one it applied, so the
     * turns the page missed arrive on the second look.
     */
    const follow = (id: string) => {
      /** The line this feed last put in the strip, so only its own report clears. */
      let reported = ''
      return keepsRunning(
        'the session feed',
        client.events({ sessionId: id }).pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              yield* Effect.sync(() => {
                update((now) => {
                  // A feed that reached the page again is working: it takes its
                  // own line back, and leaves anything else the reader was told.
                  const cleared =
                    reported !== '' && now.problem === reported ? withProblem(now, '') : now
                  return applyUiEvent(cleared, event)
                })
              })
              if (event.kind === 'session' && needsRefresh(event.event.type)) yield* relist()
            }),
          ),
        ),
        (message) => {
          reported = message
          update((now) => withProblem(now, message))
        },
      )
    }

    const show = (id: string | undefined) =>
      Effect.gen(function* () {
        const summary = yield* client.open(id === undefined ? {} : { sessionId: id })
        if (following !== undefined) yield* Fiber.interrupt(following)
        const running = yield* client.state({ sessionId: summary.id })
        yield* Effect.sync(() => {
          update((now) => withRun(withSession(now, summary), running))
          addressSession(summary.id)
        })
        following = yield* Effect.forkScoped(follow(summary.id))
        yield* watch(summary.id)
      })
    /* jscpd:ignore-end */

    yield* Effect.sync(() => {
      update((now) => withConnection(now, true))
    })

    /**
     * What one command the core never took means for the reader: the line is said
     * out loud, and the draft comes back when the line was the reader's own, so
     * nothing they typed is thrown away in silence.
     */
    const notTaken = (
      addressed: { readonly sessionId: string; readonly command: UiCommand },
      why: string,
    ): Effect.Effect<void> =>
      Effect.sync(() => {
        update((now) => {
          const text = addressed.command.kind === 'submit' ? addressed.command.text : undefined
          const kept = text !== undefined && now.draft.trim() === '' ? withDraft(now, text) : now
          return withProblem(kept, why)
        })
      })

    yield* Effect.forkScoped(
      Stream.runForEach(Stream.fromQueue(commands), (addressed) =>
        client.command(addressed).pipe(
          // A false answer is the core saying it does not hold that session: the
          // page opens it again, and the next command lands somewhere real.
          Effect.tap((accepted) =>
            accepted
              ? Effect.void
              : Effect.andThen(
                  notTaken(addressed, 'the core did not take the ' + addressed.command.kind),
                  Effect.sync(() => Queue.offerUnsafe(moves, addressed.sessionId)),
                ),
          ),
          // `ignore` would let a defect kill this fiber, and every later command
          // would sit in the queue with nothing left to send it. A call the far
          // side interrupted is not the page moving on: the command never landed,
          // and the reader is owed that line rather than silence.
          Effect.catchCause((cause) => notTaken(addressed, causeText(cause))),
        ),
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
          Effect.catchCause((cause) =>
            Effect.sync(() => update((now) => withProblem(now, causeText(cause)))),
          ),
        ),
      ),
    )

    const settings = yield* client.settings()
    yield* Effect.sync(() => update((now) => withSettings(now, settings)))

    const listed = yield* client.sessions()
    yield* Effect.sync(() => update((now) => withSessions(now, listed.items)))
    yield* Effect.forEach(listed.opened, watch)

    // The session the page opens, then one more for every move: a click, or a new session.
    const current = state()
    const wanted =
      current.sessionId !== '' ? current.sessionId : (sessionInUrl(search) ?? listed.initial)
    yield* Stream.runForEach(
      Stream.concat(Stream.fromIterable([wanted]), Stream.fromQueue(moves)),
      (id) =>
        show(id).pipe(
          Effect.catchCause((cause) =>
            unlessInterrupted(
              cause,
              Effect.sync(() => update((now) => withProblem(now, causeText(cause)))),
            ),
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
    const theme = keptTheme()
    update((now) => withTheme(now, theme))
    showTheme(theme)
    bridge.start(runnable)
  }

  const sendTo = (sessionId: string, command: UiCommand): void => {
    Queue.offerUnsafe(commands, { sessionId, command })
  }

  return {
    state,
    watched,
    start,
    stop: () => bridge.stop(),
    setDraft: (draft) => update((now) => withDraft(now, draft)),
    submit: () => {
      const current = state()
      const value = current.draft.trim()
      if (value === '') return
      const ask = current.conversation.ask
      sendTo(
        current.sessionId,
        ask === undefined
          ? { kind: 'submit', text: value }
          : { kind: 'answer', id: ask.id, answer: value },
      )
      update((now) => withDraft(now, ''))
    },
    send: (command) => sendTo(state().sessionId, command),
    sendTo,
    moveTo: (id) => Queue.offerUnsafe(moves, id),
    chooseTheme: (theme) => {
      update((now) => withTheme(now, theme))
      showTheme(theme)
      keepTheme(theme)
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
