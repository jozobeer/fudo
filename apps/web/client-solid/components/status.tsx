import { Show } from 'solid-js'
import { hintOf } from '../lib.ts'
import type { SessionStore } from '../store.ts'

/** The strip along the top: the connection, where the session runs, what happens next. */
export const Status = (props: { store: SessionStore }) => {
  const state = () => props.store.state()
  return (
    <>
      <span class={'dot ' + (state().connected ? 'on' : 'off')} />
      <span class="title">jozo-harness</span>
      <Show when={state().info.cwd !== ''}>
        <span class="where">{state().info.cwd}</span>
      </Show>
      <span class={'hint' + (state().problem === '' ? '' : ' error')}>{hintOf(state())}</span>
    </>
  )
}
