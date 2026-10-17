import { For } from 'solid-js'
import { basenameOf, whenOf } from '../lib.ts'
import type { SessionStore } from '../store.ts'

/** The sessions the store holds, the one on screen marked, and the way to a new one. */
export const Rail = (props: { store: SessionStore }) => {
  const state = () => props.store.state()
  return (
    <>
      <div class="brand">jozo-harness</div>
      <button class="primary" type="button" onClick={() => props.store.moveTo(undefined)}>
        New session
      </button>
      <nav id="session-list" aria-label="Sessions">
        <For each={state().sessions}>
          {(summary) => (
            <button
              class={'session' + (summary.id === state().sessionId ? ' active' : '')}
              type="button"
              onClick={() => props.store.moveTo(summary.id)}
            >
              <span class="session-name">
                {summary.title === '' ? summary.id.slice(0, 8) : summary.title}
              </span>
              <span class="session-when">{whenOf(summary.createdAt, Date.now())}</span>
              <span class="session-where">
                {summary.id.slice(0, 8) + ' · ' + basenameOf(summary.cwd)}
              </span>
            </button>
          )}
        </For>
      </nav>
      <div id="rail-foot">
        <span class="rail-label">store</span>
        <div class="rail-store">{state().settings?.sessionRoot ?? '…'}</div>
      </div>
    </>
  )
}
