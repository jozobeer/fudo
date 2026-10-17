/** What the conversation element reports about its own scrolling. */
export interface ScrollBox {
  readonly scrollTop: number
  readonly clientHeight: number
  readonly scrollHeight: number
}

/** Room left below the fold, in pixels, that still counts as reading the tail. */
export const FOLLOW_SLACK = 24

/**
 * True while new output should pull the view down. A reader who scrolled up
 * keeps their place; the next paint must not drag them back to the bottom.
 */
export const followsBottom = (box: ScrollBox, slack = FOLLOW_SLACK): boolean =>
  box.scrollHeight - box.scrollTop - box.clientHeight <= slack
