import { Show } from 'solid-js'
import { hintOf } from '../lib.ts'
import type { SessionStore } from '../store.ts'

/** The strip along the top: the connection, where the session runs, what happens next. */
export const Status = (props: { store: SessionStore }) => {
  const state = () => props.store.state()
  /** An approval or a question waits on the reader: the one thing the strip should shout. */
  const waiting = (): boolean =>
    state().conversation.approval !== undefined || state().conversation.ask !== undefined
  const hintClass = (): string =>
    'hint' + (state().problem !== '' ? ' error' : waiting() ? ' attention' : '')
  return (
    <>
      <button
        id="drawer-toggle"
        class="drawer-toggle"
        type="button"
        aria-label="sessions"
        aria-controls="sidebar"
        onClick={() => document.body.toggleAttribute('data-drawer')}
      >
        ☰
      </button>
      <span class={'dot ' + (state().connected ? 'on' : 'off')} />
      <Show when={state().info.cwd !== ''}>
        {/* The strip clips the head of a long path; bdi keeps the path itself left to right. */}
        <span class="where" title={state().info.cwd}>
          <bdi>{state().info.cwd}</bdi>
        </span>
      </Show>
      <span class={hintClass()}>{hintOf(state())}</span>
    </>
  )
}
