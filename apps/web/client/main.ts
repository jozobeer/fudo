import { Effect, Queue, Schedule, Stream } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'
import type { UiCommand } from '@jozo-harness/ui-protocol'
import { UiRpcs, withoutServices } from '../src/shared/rpc.ts'
import { followsBottom } from './scroll.ts'
import { applyUiEvent, initialState, withConnection, withDraft, type WebState } from './state.ts'
import { renderConversation, renderStatus } from './view.ts'

const conversationElement = document.getElementById('conversation')
const statusElement = document.getElementById('status')
const form = document.getElementById('composer')
const input = document.getElementById('input')
const cancelButton = document.getElementById('cancel')
if (
  conversationElement === null ||
  statusElement === null ||
  form === null ||
  input === null ||
  cancelButton === null ||
  !(input instanceof HTMLTextAreaElement)
) {
  throw new Error('the page is missing its skeleton')
}

let state: WebState = initialState
const commands = Effect.runSync(Queue.unbounded<UiCommand>())

const paint = (): void => {
  // Where the reader was, read before the DOM moves: only a view at the bottom follows it.
  const follow = followsBottom(conversationElement)
  conversationElement.innerHTML = renderConversation(state.conversation)
  statusElement.innerHTML = renderStatus(state)
  if (follow) conversationElement.scrollTop = conversationElement.scrollHeight
}

const paintStatus = (): void => {
  statusElement.innerHTML = renderStatus(state)
}

const send = (command: UiCommand): void => {
  Queue.offerUnsafe(commands, command)
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
  yield* Effect.sync(() => {
    state = withConnection(state, true)
    paint()
  })
  yield* Effect.forkScoped(
    Stream.runForEach(Stream.fromQueue(commands), (command) =>
      client.command(command).pipe(Effect.ignore),
    ),
  )
  yield* Stream.runForEach(client.events(), (event) =>
    Effect.sync(() => {
      state = applyUiEvent(state, event)
      paint()
    }),
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
