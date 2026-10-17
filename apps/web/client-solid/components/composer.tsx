import { For, Match, Show, Switch, onCleanup, onMount } from 'solid-js'
import { plainText } from '@jozo-harness/ui-view'
import type { SessionStore } from '../store.ts'

/** The composer grows with its draft, up to the height of a page. */
const grow = (node: HTMLTextAreaElement): void => {
  node.style.height = 'auto'
  node.style.height = Math.min(node.scrollHeight, 220) + 'px'
}

/** What the human typed while a turn was running waits above the composer. */
const Queue = (props: { store: SessionStore }) => (
  <For each={props.store.state().run?.queued ?? []}>
    {(message) => (
      <div class="queued">
        <span class="queued-label">queued</span>
        <span class="queued-text">{plainText(message)}</span>
      </div>
    )}
  </For>
)

/** The two ways the page answers for the human: an approval, or a question. */
const Takeover = (props: { store: SessionStore }) => {
  const conversation = () => props.store.state().conversation
  return (
    <Switch>
      <Match when={conversation().approval}>
        {(approval) => (
          <section class="block approval takeover-card">
            <div class="approval-text">
              <strong>{'Approve ' + approval().tool + '?'}</strong>
              <Show when={approval().reason !== ''}>
                <span class="approval-reason">{' ' + approval().reason}</span>
              </Show>
            </div>
            <div class="approval-actions">
              <button
                class="primary"
                type="button"
                onClick={() =>
                  props.store.send({
                    kind: 'approve',
                    callId: approval().callId,
                    approved: true,
                  })
                }
              >
                Allow
              </button>
              <button
                type="button"
                onClick={() =>
                  props.store.send({
                    kind: 'approve',
                    callId: approval().callId,
                    approved: false,
                  })
                }
              >
                Deny
              </button>
            </div>
            <div class="card-hint">or press y / n</div>
          </section>
        )}
      </Match>
      <Match when={conversation().ask}>
        {(ask) => (
          <section class="block takeover-card">
            <div class="takeover-text">{plainText(ask().question).split('\n')[0] ?? ''}</div>
            <Show when={ask().options.length > 0}>
              <div class="ask-options">
                <For each={ask().options}>
                  {(option) => (
                    <button
                      type="button"
                      onClick={() =>
                        props.store.send({ kind: 'answer', id: ask().id, answer: option })
                      }
                    >
                      {plainText(option)}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <div class="card-hint">or type an answer and press Enter</div>
          </section>
        )}
      </Match>
    </Switch>
  )
}

/** The input, and what sits above it: waiting input and the thing to answer. */
export const Composer = (props: { store: SessionStore }) => {
  let textarea: HTMLTextAreaElement | undefined

  onMount(() => {
    // y and n answer a pending approval, as long as the composer does not have the keys.
    const onKey = (event: KeyboardEvent): void => {
      const approval = props.store.state().conversation.approval
      if (approval === undefined || document.activeElement === textarea) return
      const key = event.key.toLowerCase()
      if (key !== 'y' && key !== 'n') return
      event.preventDefault()
      props.store.send({ kind: 'approve', callId: approval.callId, approved: key === 'y' })
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => document.removeEventListener('keydown', onKey))
  })

  const send = (): void => {
    props.store.submit()
    if (textarea !== undefined) grow(textarea)
  }

  return (
    <footer>
      <div id="queue">
        <Queue store={props.store} />
      </div>
      <div id="takeover">
        <Takeover store={props.store} />
      </div>
      <form
        id="composer"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <textarea
          id="input"
          rows="1"
          placeholder="Message jozo-harness…  (Enter sends, Shift+Enter adds a line)"
          value={props.store.state().draft}
          ref={(node) => {
            textarea = node
          }}
          onInput={(event) => {
            props.store.setDraft(event.currentTarget.value)
            grow(event.currentTarget)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div class="actions">
          <div id="seat">
            <Show when={props.store.state().info.model !== ''}>
              <button
                id="seat-model"
                class="seat-chip"
                type="button"
                title="the model this run uses"
                onClick={() => props.store.showPane({ kind: 'settings' })}
              >
                {props.store.state().info.model}
              </button>
            </Show>
          </div>
          <button id="send" class="primary" type="submit">
            Send
          </button>
          <button id="cancel" type="button" onClick={() => props.store.send({ kind: 'cancel' })}>
            Stop
          </button>
        </div>
      </form>
    </footer>
  )
}
