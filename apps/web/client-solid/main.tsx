import { render } from 'solid-js/web'
import { App } from './app.tsx'
import './style.css'

const root = document.getElementById('root')
if (root === null) throw new Error('the page has no #root to render into')
render(() => <App />, root)
