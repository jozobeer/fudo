/** The ways a page may be lit; `system` follows the machine. */
export const THEMES = ['system', 'dark', 'light'] as const

export type Theme = (typeof THEMES)[number]

/** What a page uses before the reader says otherwise. */
export const DEFAULT_THEME: Theme = 'system'

/** Where the reader's choice is kept between visits. */
export const THEME_KEY = 'jzh.theme'

/** What to make of a stored value: anything the list does not name is the system's. */
export const themeFrom = (stored: string | null): Theme =>
  THEMES.find((theme) => theme === stored) ?? DEFAULT_THEME

/** The attribute the stylesheet keys on; the system's choice carries none. */
export const themeAttribute = (theme: Theme): string | undefined =>
  theme === 'system' ? undefined : theme
