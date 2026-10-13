import { Effect, Queue, Schedule, Stream } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'
import type { UiCommand } from '@fudo/ui-protocol'
import { UiRpcs, withoutServices } from '../src/shared/rpc.ts'
import { applyUiEvent, initialState, withDraft, withConnection, type WebState } from './state.ts'
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
  conversationElement.innerHTML = renderConversation(state.conversation)
  statusElement.innerHTML = renderStatus(state)
  conversationElement.scrollTop = conversationElement.scrollHeight
}

const paintStatus = (): void => {
  statusElement.innerHTML = renderStatus(state)
}

const send = (command: UiCommand): void => {
  Queue.offerUnsafe(commands, command)
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
  if (callId === undefined) return
  send({ kind: 'approve', callId, approved: target.dataset.approve === 'true' })
})

paint()
void Effect.runPromise(Effect.retry(program, Schedule.spaced('1 second'))).catch(() => undefined)
