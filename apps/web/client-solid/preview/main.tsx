import { render } from 'solid-js/web'
import { App } from '../app.tsx'
import { lensFrom } from '../lens.ts'
import '../style.css'
import { createPreviewStore } from './store.ts'

// The page over made-up sessions: `vp -C apps/web/client-solid dev`, then /solid/preview/
// (?session=<id> picks one, ?theme=dark|light lights it, ?lens=timeline reads the trace).
const search = new URLSearchParams(location.search)
const theme = search.get('theme')
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme

const root = document.getElementById('root')
if (root === null) throw new Error('the page has no #root to render into')
render(() => <App store={createPreviewStore()} lens={lensFrom(search.get('lens'))} />, root)
