import { onCleanup, onMount } from 'solid-js'
import { Composer } from './components/composer.tsx'
import { ContextPane } from './components/context-pane.tsx'
import { Conversation } from './components/conversation.tsx'
import { Board } from './components/board.tsx'
import { Status } from './components/status.tsx'
import { Waterfall } from './components/waterfall.tsx'
import { createSessionStore, type SessionStore } from './store.ts'

/** The page: the strip, the sessions drawer, the chat, the trace, and the inspector. */
export const App = (props: { store?: SessionStore }) => {
  const store = props.store ?? createSessionStore()
  onMount(() => {
    store.start()
    onCleanup(() => store.stop())
  })
  return (
    <>
      <header id="status" aria-live="polite">
        <Status store={store} />
      </header>
      <div id="shell">
        <aside id="sidebar">
          <Board store={store} />
        </aside>
        <div id="main">
          <Conversation store={store} />
          <Composer store={store} />
        </div>
        <Waterfall store={store} />
        <aside id="context" aria-label="Context">
          <ContextPane store={store} />
        </aside>
      </div>
    </>
  )
}
