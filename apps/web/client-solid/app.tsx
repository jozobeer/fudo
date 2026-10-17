import { createSignal, onCleanup, onMount } from 'solid-js'
import { Board } from './components/board.tsx'
import { Composer } from './components/composer.tsx'
import { ContextPane } from './components/context-pane.tsx'
import { Conversation } from './components/conversation.tsx'
import { LensSwitch } from './components/lens-switch.tsx'
import { Status } from './components/status.tsx'
import { Waterfall } from './components/waterfall.tsx'
import { LENS_KEY, lensFrom, type Lens } from './lens.ts'
import { createSessionStore, type SessionStore } from './store.ts'

/** The page: the strip, the board of sessions, the answers or the trace, and the pane. */
export const App = (props: { store?: SessionStore; lens?: Lens }) => {
  const store = props.store ?? createSessionStore()
  const [lens, setLens] = createSignal(props.lens ?? lensFrom(localStorage.getItem(LENS_KEY)))
  const choose = (next: Lens): void => {
    setLens(next)
    localStorage.setItem(LENS_KEY, next)
  }
  onMount(() => {
    store.start()
    onCleanup(() => store.stop())
  })
  // Both readings stay mounted, so switching back finds the place and the open steps it left.
  return (
    <>
      <header id="status" aria-live="polite">
        <Status store={store} />
      </header>
      <div id="shell">
        <aside id="sidebar">
          <Board store={store} />
        </aside>
        <div id="main" data-lens={lens()}>
          <div class="column-head">
            <LensSwitch lens={lens()} onChoose={choose} />
          </div>
          <Conversation store={store} />
          <Waterfall store={store} />
          <Composer store={store} />
        </div>
        <aside id="context" aria-label="Context">
          <ContextPane store={store} />
        </aside>
      </div>
    </>
  )
}
