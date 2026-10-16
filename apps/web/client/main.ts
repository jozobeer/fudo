import { Effect, Fiber, Queue, Schedule, Stream } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'
import type { UiCommand } from '@jozo-harness/ui-protocol'
import { UiRpcs, withoutServices } from '../src/shared/rpc.ts'
import { followsBottom } from './scroll.ts'
import {
  applyUiEvent,
  initialState,
  withConnection,
  withDraft,
  withProblem,
  withSession,
  withSessions,
  type WebState,
} from './state.ts'
import { renderConversation, renderSessions, renderStatus } from './view.ts'

const conversationElement = document.getElementById('conversation')
const statusElement = document.getElementById('status')
const form = document.getElementById('composer')
const input = document.getElementById('input')
const cancelButton = document.getElementById('cancel')
const newSessionButton = document.getElementById('new-session')
const sessionListElement = document.getElementById('session-list')
if (
  conversationElement === null ||
  statusElement === null ||
  form === null ||
  input === null ||
  cancelButton === null ||
  newSessionButton === null ||
  sessionListElement === null ||
  !(input instanceof HTMLTextAreaElement)
) {
  throw new Error('the page is missing its skeleton')
}

let state: WebState = initialState
const commands = Effect.runSync(Queue.unbounded<UiCommand>())
/** What the page was asked to read: a session id, or undefined for a new session. */
const moves = Effect.runSync(Queue.unbounded<string | undefined>())
/** The subscription the page follows; replaced every time it moves. */
let following: Fiber.Fiber<void, unknown> | undefined

const messageOf = (error: unknown): string =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)

const paint = (): void => {
  // Where the reader was, read before the DOM moves: only a view at the bottom follows it.
  const follow = followsBottom(conversationElement)
  conversationElement.innerHTML = renderConversation(state.conversation)
  statusElement.innerHTML = renderStatus(state)
  sessionListElement.innerHTML = renderSessions(state)
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

const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ui'

const session = Effect.gen(function* () {
  const client = yield* RpcClient.make(UiRpcs)

  // Reads the store again, so a session that just earned its name shows it.
  const relist = () =>
    Effect.gen(function* () {
      const listed = yield* client.sessions()
      yield* Effect.sync(() => {
        state = withSessions(state, listed.items)
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
          // A finished turn is where a session earns the name the rail shows.
          if (event.kind === 'session' && event.event.type === 'turn/end') yield* relist()
        }),
      ),
    )

  const show = (id: string | undefined) =>
    Effect.gen(function* () {
      const summary = yield* client.open(id === undefined ? {} : { sessionId: id })
      if (following !== undefined) yield* Fiber.interrupt(following)
      yield* Effect.sync(() => {
        state = withSession(state, summary)
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

sessionListElement.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const row = target.closest('button.session')
  const id = row instanceof HTMLButtonElement ? row.dataset.sessionId : undefined
  if (id !== undefined) moveTo(id)
})

conversationElement.addEventListener('click', (event) => {
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

grow()
paint()
void Effect.runPromise(Effect.retry(program, Schedule.spaced('1 second'))).catch(() => undefined)
