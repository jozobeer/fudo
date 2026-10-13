export interface Size {
  readonly columns: number
  readonly rows: number
}

export const DEFAULT_SIZE: Size = { columns: 80, rows: 24 }

/** Ranges drawn two cells wide by common terminal fonts. */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
]

const isWide = (codePoint: number): boolean =>
  WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)

export const charWidth = (codePoint: number): number => (isWide(codePoint) ? 2 : 1)

export const displayWidth = (text: string): number => {
  let width = 0
  for (const char of text) width += charWidth(char.codePointAt(0) ?? 0)
  return width
}

const wrapLine = (line: string, width: number): ReadonlyArray<string> => {
  const out: Array<string> = []
  let current = ''
  let used = 0
  for (const char of line) {
    const cells = charWidth(char.codePointAt(0) ?? 0)
    if (used + cells > width && current !== '') {
      out.push(current)
      current = ''
      used = 0
    }
    current += char
    used += cells
  }
  out.push(current)
  return out
}

/** Cuts to `width` display cells without splitting a wide character. */
export const clipText = (text: string, width: number): string => {
  let out = ''
  let used = 0
  for (const char of text) {
    const cells = charWidth(char.codePointAt(0) ?? 0)
    if (used + cells > width) break
    out += char
    used += cells
  }
  return out
}

/** Wraps to `width` display cells, splitting on newlines first. */
export const wrapText = (text: string, width: number): ReadonlyArray<string> =>
  width <= 0 ? [''] : text.split('\n').flatMap((line) => wrapLine(line, width))
