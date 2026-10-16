import type { KeyEvent } from './keys.ts'

/** The room the conversation has: `lines` wrapped lines inside a window `height` rows tall. */
export interface Viewport {
  readonly lines: number
  readonly height: number
}

/**
 * Where the window sits. `tail` follows new output; `pinned` holds the line the
 * reader chose, so output arriving below it does not move what they are reading.
 */
export type Scroll = { readonly kind: 'tail' } | { readonly kind: 'pinned'; readonly top: number }

export const TAIL: Scroll = { kind: 'tail' }

const maxTop = (viewport: Viewport): number => Math.max(0, viewport.lines - viewport.height)

/** The first visible line. A pinned line past the last page is pulled back onto it. */
export const windowTop = (scroll: Scroll, viewport: Viewport): number =>
  scroll.kind === 'tail' ? maxTop(viewport) : Math.min(Math.max(0, scroll.top), maxTop(viewport))

/** Lines hidden below the window; 0 means the tail is on screen. */
export const linesBelow = (scroll: Scroll, viewport: Viewport): number =>
  Math.max(0, viewport.lines - windowTop(scroll, viewport) - viewport.height)

const at = (top: number, viewport: Viewport): Scroll =>
  top >= maxTop(viewport) ? TAIL : { kind: 'pinned', top }

/** One page back from where the window is now. */
export const pageBack = (scroll: Scroll, viewport: Viewport): Scroll =>
  at(Math.max(0, windowTop(scroll, viewport) - viewport.height), viewport)

/** One page towards the tail; the last page follows new output again. */
export const pageForward = (scroll: Scroll, viewport: Viewport): Scroll =>
  at(windowTop(scroll, viewport) + viewport.height, viewport)

/** The scroll a key asks for, or undefined when the key is not about scrolling. */
export const scrollKey = (
  scroll: Scroll,
  key: KeyEvent,
  viewport: Viewport,
): Scroll | undefined => {
  if (key.kind === 'pageUp') return pageBack(scroll, viewport)
  if (key.kind === 'pageDown') return pageForward(scroll, viewport)
  return key.kind === 'escape' && scroll.kind === 'pinned' ? TAIL : undefined
}
