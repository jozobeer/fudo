import { Effect, Fiber, Queue, Schedule, Stream } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'
import type { UiCommand } from '@jozo-harness/ui-protocol'
import { UiRpcs, withoutServices } from '../src/shared/rpc.ts'
import { followsBottom } from '../src/ui/scroll.ts'
import {
  applyUiEvent,
  initialState,
  withConnection,
  withDraft,
  withModels,
  withPane,
  withProblem,
  withSession,
  withRun,
  withSessions,
  withSettings,
  withTheme,
  type WebState,
} from '../src/ui/state.ts'
import { THEME_KEY, themeAttribute, themeFrom, type Theme } from '../src/ui/theme.ts'
import {
  renderConversation,
  renderContext,
  renderQueue,
  renderRail,
  renderSeat,
  renderSessions,
  renderStatus,
  renderTakeover,
} from './view.ts'

const conversationElement = document.getElementById('conversation')
const statusElement = document.getElementById('status')
const form = document.getElementById('composer')
const input = document.getElementById('input')
const cancelButton = document.getElementById('cancel')
const newSessionButton = document.getElementById('new-session')
const sessionListElement = document.getElementById('session-list')
const railFootElement = document.getElementById('rail-foot')
const contextElement = document.getElementById('context')
const queueElement = document.getElementById('queue')
const takeoverElement = document.getElementById('takeover')
const seatElement = document.getElementById('seat')
if (
  conversationElement === null ||
  statusElement === null ||
  form === null ||
  input === null ||
  cancelButton === null ||
  newSessionButton === null ||
  sessionListElement === null ||
  railFootElement === null ||
  contextElement === null ||
  queueElement === null ||
  takeoverElement === null ||
  seatElement === null ||
  !(input instanceof HTMLTextAreaElement)
) {
  throw new Error('the page is missing its skeleton')
}

/** Writes the reader's choice where the stylesheet reads it; the system's is its own. */
const applyTheme = (theme: Theme): void => {
  const attribute = themeAttribute(theme)
  if (attribute === undefined) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = attribute
}

let state: WebState = initialState
const commands = Effect.runSync(Queue.unbounded<UiCommand>())
/** What the page was asked to read: a session id, or undefined for a new session. */
const moves = Effect.runSync(Queue.unbounded<string | undefined>())
/** The subscription the page follows; replaced every time it moves. */
let following: Fiber.Fiber<void, unknown> | undefined
/** What the settings sheet asked the server for. */
type PanelAsk =
  | { readonly kind: 'models' }
  | { readonly kind: 'setModel'; readonly model: string }
  | { readonly kind: 'job'; readonly id: string }
  | { readonly kind: 'stopJob'; readonly id: string }
const panelAsks = Effect.runSync(Queue.unbounded<PanelAsk>())

const messageOf = (error: unknown): string =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)

const paint = (): void => {
  // Where the reader was, read before the DOM moves: only a view at the bottom follows it.
  const follow = followsBottom(conversationElement)
  conversationElement.innerHTML = renderConversation(state.conversation)
  statusElement.innerHTML = renderStatus(state)
  sessionListElement.innerHTML = renderSessions(state)
  railFootElement.innerHTML = renderRail(state)
  contextElement.innerHTML = renderContext(state)
  queueElement.innerHTML = renderQueue(state)
  takeoverElement.innerHTML = renderTakeover(state)
  seatElement.innerHTML = renderSeat(state)
  if (follow) conversationElement.scrollTop = conversationElement.scrollHeight
}

const paintStatus = (): void => {
  statusElement.innerHTML = renderStatus(state)
}

const send = (command: UiCommand): void => {
  Queue.offerUnsafe(commands, command)
}

const moveTo = (id: string | undefined): void => {
  Queue.offerUnsafe(moves, id)
}

const sessionInUrl = (search: string): string | undefined => {
  const value = new URLSearchParams(search).get('session')
  return value === null || value === '' ? undefined : value
}

/** The composer grows with its draft, up to the height of a page. */
const grow = (): void => {
  input.style.height = 'auto'
  input.style.height = Math.min(input.scrollHeight, 220) + 'px'
}

const submit = (): void => {
  const value = state.draft.trim()
  if (value === '') return
  const ask = state.conversation.ask
  send(
    ask === undefined
      ? { kind: 'submit', text: value }
      : { kind: 'answer', id: ask.id, answer: value },
  )
  state = withDraft(state, '')
  input.value = ''
  grow()
  paintStatus()
}

/** The events after which the page reads the store and the run state again. */
const needsRefresh = (type: string): boolean =>
  type === 'turn/end' || type.startsWith('agent/inbox/')

const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ui'

const session = Effect.gen(function* () {
  const client = yield* RpcClient.make(UiRpcs)

  // Reads the store and the run state again: a session earns its name and its goal as it works.
  const relist = () =>
    Effect.gen(function* () {
      const listed = yield* client.sessions()
      const running =
        state.sessionId === '' ? undefined : yield* client.state({ sessionId: state.sessionId })
      yield* Effect.sync(() => {
        state = withSessions(state, listed.items)
        if (running !== undefined) state = withRun(state, running)
        paint()
      })
    })

  // Everything one session logs, until the socket or the page moves on.
  const follow = (id: string) =>
    client.events({ sessionId: id }).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            state = applyUiEvent(state, event)
            paint()
          })
          // A finished turn is where a session earns its name; the inbox is where input waits.
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
        state = withRun(withSession(state, summary), running)
        history.replaceState(null, '', '?session=' + encodeURIComponent(summary.id))
        paint()
      })
      following = yield* Effect.forkScoped(follow(summary.id))
    })

  const complain = (error: unknown): Effect.Effect<void> =>
    Effect.sync(() => {
      state = withProblem(state, messageOf(error))
      paint()
    })

  yield* Effect.sync(() => {
    state = withConnection(state, true)
    paint()
  })
  yield* Effect.forkScoped(
    Stream.runForEach(Stream.fromQueue(commands), (command) =>
      client.command({ sessionId: state.sessionId, command }).pipe(Effect.ignore),
    ),
  )
  yield* Effect.forkScoped(
    Stream.runForEach(Stream.fromQueue(panelAsks), (ask) =>
      Effect.gen(function* () {
        if (ask.kind === 'models') {
          const models = yield* client.models()
          yield* Effect.sync(() => {
            state = withModels(state, models)
            paint()
          })
          return
        }
        if (ask.kind === 'job') {
          const detail = yield* client.jobDetail({ sessionId: state.sessionId, id: ask.id })
          yield* Effect.sync(() => {
            state = withPane(state, { kind: 'job', id: ask.id, detail })
            paint()
          })
          return
        }
        if (ask.kind === 'stopJob') {
          yield* client.stopJob({ sessionId: state.sessionId, id: ask.id })
          yield* relist()
          const detail = yield* client.jobDetail({ sessionId: state.sessionId, id: ask.id })
          yield* Effect.sync(() => {
            state = withPane(state, { kind: 'job', id: ask.id, detail })
            paint()
          })
          return
        }
        yield* client.setModel({ model: ask.model })
        // Read it back, so the sheet shows what the file now holds.
        const settings = yield* client.settings()
        yield* Effect.sync(() => {
          state = withSettings(state, settings)
          paint()
        })
      }).pipe(Effect.catch(complain)),
    ),
  )

  const settings = yield* client.settings()
  yield* Effect.sync(() => {
    state = withSettings(state, settings)
    paint()
  })

  const listed = yield* client.sessions()
  yield* Effect.sync(() => {
    state = withSessions(state, listed.items)
    paint()
  })
  // The session the page opens, then one more for every move: a click, or a new session.
  const wanted =
    state.sessionId !== '' ? state.sessionId : (sessionInUrl(location.search) ?? listed.initial)
  yield* Stream.runForEach(
    Stream.concat(Stream.fromIterable([wanted]), Stream.fromQueue(moves)),
    (id) => show(id).pipe(Effect.catch(complain)),
  )
})

const program = withoutServices(
  session.pipe(
    Effect.ensuring(
      Effect.sync(() => {
        state = withConnection(state, false)
        paintStatus()
      }),
    ),
    Effect.provide(RpcClient.layerProtocolSocket()),
    Effect.provide(Socket.layerWebSocket(wsUrl)),
    Effect.provide(Socket.layerWebSocketConstructorGlobal),
    Effect.provide(RpcSerialization.layerJson),
    Effect.scoped,
  ),
)

form.addEventListener('submit', (event) => {
  event.preventDefault()
  submit()
})

input.addEventListener('input', () => {
  state = withDraft(state, input.value)
  grow()
})

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
})

cancelButton.addEventListener('click', () => {
  send({ kind: 'cancel' })
})

newSessionButton.addEventListener('click', () => {
  moveTo(undefined)
})

/** Applies and remembers the reader's choice. */
const chooseTheme = (stored: string): void => {
  const theme = themeFrom(stored)
  state = withTheme(state, theme)
  applyTheme(theme)
  localStorage.setItem(THEME_KEY, theme)
  paint()
}

/** Opens one background command in the pane, with the output it has kept. */
const openJob = (id: string): void => {
  state = withPane(state, { kind: 'job', id, detail: undefined })
  Queue.offerUnsafe(panelAsks, { kind: 'job', id })
  paint()
}

/** Shows one surface in the pane, or hides the body when it is already showing. */
const showPane = (kind: 'run' | 'settings' | 'trajectory'): void => {
  state = withPane(state, state.pane?.kind === kind ? undefined : { kind })
  paint()
}

/** The pane's tab strip: one button per surface the pane can show. */
const tabs: Readonly<Record<string, () => void>> = {
  run: () => showPane('run'),
  settings: () => showPane('settings'),
  trajectory: () => showPane('trajectory'),
}

/** What each button inside the pane body does; one entry per button drawn there. */
const paneActions: Readonly<Record<string, () => void>> = {
  'panel-close': () => {
    state = withPane(state, undefined)
    paint()
  },
  'stop-job': () => {
    const pane = state.pane
    if (pane?.kind === 'job') Queue.offerUnsafe(panelAsks, { kind: 'stopJob', id: pane.id })
  },
  'ask-models': () => {
    Queue.offerUnsafe(panelAsks, { kind: 'models' })
  },
  'use-model': () => {
    const choice = document.getElementById('model-choice')
    if (choice instanceof HTMLSelectElement && choice.value !== '') {
      Queue.offerUnsafe(panelAsks, { kind: 'setModel', model: choice.value })
    }
  },
}

// The seat names the model; pressing it shows the settings tab that changes it.
seatElement.addEventListener('click', (event) => {
  const target = event.target
  if (target instanceof HTMLButtonElement && target.id === 'seat-model') showPane('settings')
})

contextElement.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLButtonElement)) return
  const named = tabs[target.id] ?? paneActions[target.id]
  if (named !== undefined) {
    named()
    return
  }
  const job = target.dataset.jobId
  if (job !== undefined) {
    openJob(job)
    return
  }
  // A child session a subagent started reads like any other session row.
  const other = target.dataset.sessionId
  if (other !== undefined) {
    moveTo(other)
    return
  }
  const stored = target.dataset.theme
  if (stored !== undefined) chooseTheme(stored)
})

sessionListElement.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const row = target.closest('button.session')
  const id = row instanceof HTMLButtonElement ? row.dataset.sessionId : undefined
  if (id !== undefined) moveTo(id)
})

// The takeover holds the two ways the page answers for the human.
takeoverElement.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLButtonElement)) return
  const callId = target.dataset.callId
  if (callId !== undefined) {
    send({ kind: 'approve', callId, approved: target.dataset.approve === 'true' })
    return
  }
  const askId = target.dataset.askId
  const answer = target.dataset.answer
  if (askId !== undefined && answer !== undefined) send({ kind: 'answer', id: askId, answer })
})

// y and n answer a pending approval, as long as the composer does not have the keys.
document.addEventListener('keydown', (event) => {
  const approval = state.conversation.approval
  if (approval === undefined || document.activeElement === input) return
  const key = event.key.toLowerCase()
  if (key !== 'y' && key !== 'n') return
  event.preventDefault()
  send({ kind: 'approve', callId: approval.callId, approved: key === 'y' })
})

state = withTheme(state, themeFrom(localStorage.getItem(THEME_KEY)))
applyTheme(state.theme)
grow()
paint()
void Effect.runPromise(Effect.retry(program, Schedule.spaced('1 second'))).catch(() => undefined)
