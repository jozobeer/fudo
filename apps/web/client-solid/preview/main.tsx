import { render } from 'solid-js/web'
import { App } from '../app.tsx'
import '../style.css'
import { createPreviewStore } from './store.ts'

// The page over made-up sessions: `vp -C apps/web/client-solid dev`, then /solid/preview/.
const root = document.getElementById('root')
if (root === null) throw new Error('the page has no #root to render into')
render(() => <App store={createPreviewStore()} />, root)
