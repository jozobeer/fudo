import { onCleanup, onMount } from 'solid-js'
import { Composer } from './components/composer.tsx'
import { ContextPane } from './components/context-pane.tsx'
import { Conversation } from './components/conversation.tsx'
import { Rail } from './components/rail.tsx'
import { Status } from './components/status.tsx'
import { createSessionStore, type SessionStore } from './store.ts'

/** The page: the strip, and three columns with the composer under the middle one. */
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
          <Rail store={store} />
        </aside>
        <div id="main">
          <Conversation store={store} />
          <Composer store={store} />
        </div>
        <aside id="context" aria-label="Context">
          <ContextPane store={store} />
        </aside>
      </div>
    </>
  )
}
