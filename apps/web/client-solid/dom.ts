import { THEME_KEY, themeAttribute, themeFrom, type Theme } from '../src/ui/theme.ts'

/**
 * The browser the page runs in, named once. These declarations are the surface
 * the page uses, written here rather than read from the DOM library, so the
 * store that drives the page can be read and run where no browser is in scope.
 */
declare const window: {
  readonly location: { readonly protocol: string; readonly host: string; readonly search: string }
}
declare const document: {
  readonly documentElement: { readonly dataset: Record<string, string | undefined> }
}
declare const history: {
  replaceState: (data: unknown, unused: string, url?: string) => void
}
declare const localStorage: {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** Where the socket lives, given the protocol the page was served with. */
export const socketAt = (protocol: string, host: string): string =>
  (protocol === 'https:' ? 'wss://' : 'ws://') + host + '/ui'

/** The socket this page talks to: the host that served it. */
export const pageSocket = (): string => socketAt(window.location.protocol, window.location.host)

/** The search string the page was opened with, which may name a session. */
export const pageSearch = (): string => window.location.search

/** Writes the reader's choice where the stylesheet reads it; the system's is its own. */
export const showTheme = (theme: Theme): void => {
  const attribute = themeAttribute(theme)
  if (attribute === undefined) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = attribute
}

/** The theme the reader chose on an earlier visit, or the system's. */
export const keptTheme = (): Theme => themeFrom(localStorage.getItem(THEME_KEY))

/** Keeps the reader's choice for the next visit. */
export const keepTheme = (theme: Theme): void => {
  localStorage.setItem(THEME_KEY, theme)
}

/** Says in the address bar which session the page reads, so a reload returns to it. */
export const addressSession = (id: string): void => {
  history.replaceState(null, '', '?session=' + encodeURIComponent(id))
}
