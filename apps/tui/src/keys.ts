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
  | { readonly kind: 'escape' }
  | { readonly kind: 'tab' }
  | { readonly kind: 'ctrl'; readonly char: string }

interface Match {
  readonly key: KeyEvent
  readonly length: number
}

const ESCAPE = '\u001b'
const PASTE_START = ESCAPE + '[200~'
const PASTE_END = ESCAPE + '[201~'

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
    if (pending.startsWith(sequence)) return { key, length: sequence.length }
  }
  for (const [sequence] of SEQUENCES) {
    if (sequence.startsWith(pending)) return 'incomplete'
  }
  return undefined
}

const decodeEscape = (pending: string): Match | 'incomplete' | undefined => {
  const matched = matchSequence(pending)
  if (matched !== undefined) return matched
  return pending === ESCAPE ? 'incomplete' : { key: { kind: 'escape' }, length: 1 }
}

const decodeNewline = (pending: string, code: number): Match | undefined => {
  if (pending.startsWith('\r\n')) return { key: { kind: 'enter' }, length: 2 }
  return code === 0x0d || code === 0x0a ? { key: { kind: 'enter' }, length: 1 } : undefined
}

const decodeControl = (code: number): Match | undefined => {
  if (code === 0x7f || code === 0x08) return { key: { kind: 'backspace' }, length: 1 }
  if (code === 0x09) return { key: { kind: 'tab' }, length: 1 }
  if (code < 0x20) {
    return { key: { kind: 'ctrl', char: String.fromCharCode(code + 0x60) }, length: 1 }
  }
  return undefined
}

const decodeOne = (pending: string): Match | 'incomplete' | undefined => {
  const code = pending.codePointAt(0) ?? 0
  if (code === 0x1b) return decodeEscape(pending)
  const newline = decodeNewline(pending, code)
  if (newline !== undefined) return newline
  const control = decodeControl(code)
  if (control !== undefined) return control
  const char = String.fromCodePoint(code)
  return { key: { kind: 'char', char }, length: char.length }
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
      if (step === undefined) {
        this.pending = this.pending.slice(1)
        continue
      }
      keys.push(step.key)
      this.pending = this.pending.slice(step.length)
    }
    return keys
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
