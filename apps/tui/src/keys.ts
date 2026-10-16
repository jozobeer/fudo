export type KeyEvent =
  | { readonly kind: 'char'; readonly char: string }
  | { readonly kind: 'enter' }
  | { readonly kind: 'backspace' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'left' }
  | { readonly kind: 'right' }
  | { readonly kind: 'up' }
  | { readonly kind: 'down' }
  | { readonly kind: 'home' }
  | { readonly kind: 'end' }
  | { readonly kind: 'pageUp' }
  | { readonly kind: 'pageDown' }
  | { readonly kind: 'wheelUp' }
  | { readonly kind: 'wheelDown' }
  | { readonly kind: 'escape' }
  | { readonly kind: 'tab' }
  | { readonly kind: 'ctrl'; readonly char: string }

/** One decoded input: the keys it produced — none for a click or a byte nothing claims — and how many bytes they took. */
interface Match {
  readonly keys: ReadonlyArray<KeyEvent>
  readonly length: number
}

const ESCAPE = '\u001b'
const PASTE_START = ESCAPE + '[200~'
const PASTE_END = ESCAPE + '[201~'
const MOUSE_START = ESCAPE + '[<'
/** What follows the start of an SGR mouse report: button, column, row, press or release. */
const MOUSE_REPORT = /^(\d+);(\d+);(\d+)[Mm]/
/** A report whose numbers are still on their way. */
const MOUSE_PARTIAL = /^\d*(?:;\d*){0,2}$/

const SEQUENCES: ReadonlyArray<readonly [string, KeyEvent]> = [
  [ESCAPE + '[A', { kind: 'up' }],
  [ESCAPE + '[B', { kind: 'down' }],
  [ESCAPE + '[C', { kind: 'right' }],
  [ESCAPE + '[D', { kind: 'left' }],
  [ESCAPE + 'OA', { kind: 'up' }],
  [ESCAPE + 'OB', { kind: 'down' }],
  [ESCAPE + 'OC', { kind: 'right' }],
  [ESCAPE + 'OD', { kind: 'left' }],
  [ESCAPE + '[H', { kind: 'home' }],
  [ESCAPE + '[F', { kind: 'end' }],
  [ESCAPE + '[1~', { kind: 'home' }],
  [ESCAPE + '[4~', { kind: 'end' }],
  [ESCAPE + '[3~', { kind: 'delete' }],
  [ESCAPE + '[5~', { kind: 'pageUp' }],
  [ESCAPE + '[6~', { kind: 'pageDown' }],
]

const matchSequence = (pending: string): Match | 'incomplete' | undefined => {
  for (const [sequence, key] of SEQUENCES) {
    if (pending.startsWith(sequence)) return { keys: [key], length: sequence.length }
  }
  for (const [sequence] of SEQUENCES) {
    if (sequence.startsWith(pending)) return 'incomplete'
  }
  return undefined
}

/** The wheel sits in the button's third bit; its two low bits pick the direction. */
const wheelKeys = (button: number): ReadonlyArray<KeyEvent> => {
  if ((button & 64) === 0) return []
  const direction = button & 3
  if (direction === 0) return [{ kind: 'wheelUp' }]
  return direction === 1 ? [{ kind: 'wheelDown' }] : []
}

/**
 * Reports from the mouse, which the UI asks for to scroll with the wheel. The
 * terminal is told to use SGR (1006), so `ESC [ < button ; column ; row M` is
 * the only shape seen here; a click is consumed as bytes and no keys.
 */
const decodeMouse = (pending: string): Match | 'incomplete' | undefined => {
  if (!pending.startsWith(MOUSE_START)) return undefined
  const rest = pending.slice(MOUSE_START.length)
  const report = MOUSE_REPORT.exec(rest)
  if (report !== null) {
    return { keys: wheelKeys(Number(report[1])), length: MOUSE_START.length + report[0].length }
  }
  return MOUSE_PARTIAL.test(rest) ? 'incomplete' : undefined
}

const decodeEscape = (pending: string): Match | 'incomplete' | undefined => {
  const matched = matchSequence(pending)
  if (matched !== undefined) return matched
  const mouse = decodeMouse(pending)
  if (mouse !== undefined) return mouse
  return pending === ESCAPE ? 'incomplete' : { keys: [{ kind: 'escape' }], length: 1 }
}

const decodeNewline = (pending: string, code: number): Match | undefined => {
  if (pending.startsWith('\r\n')) return { keys: [{ kind: 'enter' }], length: 2 }
  return code === 0x0d || code === 0x0a ? { keys: [{ kind: 'enter' }], length: 1 } : undefined
}

const decodeControl = (code: number): Match | undefined => {
  if (code === 0x7f || code === 0x08) return { keys: [{ kind: 'backspace' }], length: 1 }
  if (code === 0x09) return { keys: [{ kind: 'tab' }], length: 1 }
  if (code < 0x20) {
    return { keys: [{ kind: 'ctrl', char: String.fromCharCode(code + 0x60) }], length: 1 }
  }
  return undefined
}

/** One input: the keys it holds, or 'incomplete' when the rest is still coming. */
const decodeOne = (pending: string): Match | 'incomplete' => {
  const code = pending.codePointAt(0) ?? 0
  // An escape nothing claims is dropped one byte at a time, as it always was.
  if (code === 0x1b) return decodeEscape(pending) ?? { keys: [], length: 1 }
  const newline = decodeNewline(pending, code)
  if (newline !== undefined) return newline
  const control = decodeControl(code)
  if (control !== undefined) return control
  const char = String.fromCodePoint(code)
  return { keys: [{ kind: 'char', char }], length: char.length }
}

const pasteChar = (char: string): KeyEvent => ({
  kind: 'char',
  char: char === '\n' || char === '\r' ? ' ' : char,
})

/** Turns raw terminal bytes into keys, holding a sequence that arrived in parts. */
export class KeyDecoder {
  private pending = ''

  push(chunk: string): ReadonlyArray<KeyEvent> {
    this.pending += chunk
    const keys: Array<KeyEvent> = []
    this.drainPaste(keys)
    // A paste that has not ended yet is held whole; its bytes are not keys.
    while (this.pending !== '' && !this.pending.startsWith(PASTE_START)) {
      const step = decodeOne(this.pending)
      if (step === 'incomplete') break
      keys.push(...step.keys)
      this.pending = this.pending.slice(step.length)
    }
    return keys
  }

  /** True while a lone escape waits to hear whether a sequence follows it. */
  get holdingEscape(): boolean {
    return this.pending === ESCAPE
  }

  /** A lone escape at the end of input is the Escape key. */
  flush(): ReadonlyArray<KeyEvent> {
    if (this.pending !== ESCAPE) return []
    this.pending = ''
    return [{ kind: 'escape' }]
  }

  private drainPaste(keys: Array<KeyEvent>): void {
    let text = this.takePaste()
    while (text !== undefined) {
      for (const char of text) keys.push(pasteChar(char))
      text = this.takePaste()
    }
  }

  private takePaste(): string | undefined {
    if (!this.pending.startsWith(PASTE_START)) return undefined
    const end = this.pending.indexOf(PASTE_END, PASTE_START.length)
    if (end < 0) return undefined
    const text = this.pending.slice(PASTE_START.length, end)
    this.pending = this.pending.slice(end + PASTE_END.length)
    return text
  }
}
