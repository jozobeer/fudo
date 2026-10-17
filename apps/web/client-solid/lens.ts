/** How the middle column reads a session: what each turn left, or where its time went. */
export const LENSES = ['answers', 'timeline'] as const

export type Lens = (typeof LENSES)[number]

/** Where the reader's choice is kept between visits. */
export const LENS_KEY = 'jzh.lens'

/** What to make of a stored value: anything the list does not name reads the answers. */
export const lensFrom = (stored: string | null): Lens =>
  LENSES.find((lens) => lens === stored) ?? 'answers'
