import { onCleanup, onMount } from 'solid-js'
import { Composer } from './components/composer.tsx'
import { ContextPane } from './components/context-pane.tsx'
import { Conversation } from './components/conversation.tsx'
import { Rail } from './components/rail.tsx'
import { Status } from './components/status.tsx'
import { createSessionStore } from './store.ts'

/** The page: the strip, the three columns, and the composer with what waits on it. */
export const App = () => {
  const store = createSessionStore()
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
        <Conversation store={store} />
        <aside id="context" aria-label="Context">
          <ContextPane store={store} />
        </aside>
      </div>
      <Composer store={store} />
    </>
  )
}
