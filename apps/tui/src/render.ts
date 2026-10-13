import {
  plainText,
  type Conversation,
  type ConversationBlock,
  type NoticeLevel,
} from '@fudo/ui-view'
import type { TuiState } from './state.ts'
import { clipText, displayWidth, wrapText, type Size } from './wrap.ts'

export interface Screen {
  readonly lines: ReadonlyArray<string>
  readonly cursor: { readonly row: number; readonly column: number }
}

export interface RenderOptions {
  readonly color?: boolean
}

type Tone = 'plain' | 'dim' | 'user' | 'tool' | 'error' | 'warn' | 'ask' | 'live' | 'title'

interface DisplayLine {
  readonly text: string
  readonly tone: Tone
}

const RESET = '\u001b[0m'
const CODES: Record<Tone, string> = {
  plain: '',
  dim: '\u001b[2m',
  user: '\u001b[36m',
  tool: '\u001b[32m',
  error: '\u001b[31m',
  warn: '\u001b[33m',
  ask: '\u001b[35m',
  live: '\u001b[2m',
  title: '\u001b[1m',
}

const paint = (line: DisplayLine, color: boolean): string =>
  color && CODES[line.tone] !== '' ? CODES[line.tone] + line.text + RESET : line.text

const noticeTone = (level: NoticeLevel): Tone =>
  level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'dim'

const wrapped = (text: string, width: number, tone: Tone): ReadonlyArray<DisplayLine> =>
  wrapText(plainText(text), width).map((line) => ({ text: line, tone }))

const prefixed = (
  prefix: string,
  text: string,
  width: number,
  tone: Tone,
): ReadonlyArray<DisplayLine> => {
  const body = wrapped(text, Math.max(1, width - displayWidth(prefix)), tone)
  const pad = ' '.repeat(displayWidth(prefix))
  return body.map((line, index) => ({
    text: (index === 0 ? prefix : pad) + line.text,
    tone: line.tone,
  }))
}

const toolLines = (
  block: Extract<ConversationBlock, { kind: 'tool' }>,
  width: number,
): ReadonlyArray<DisplayLine> => {
  const head: DisplayLine = {
    text: clipText('⏺ ' + block.name + ' ' + block.summary, width),
    tone: block.status === 'error' ? 'error' : 'tool',
  }
  if (block.result === '') return [head]
  return [
    head,
    ...prefixed('  └ ', block.result, width, block.status === 'error' ? 'error' : 'dim'),
  ]
}

const blockLines = (block: ConversationBlock, width: number): ReadonlyArray<DisplayLine> => {
  switch (block.kind) {
    case 'user':
      return prefixed('› ', block.text, width, 'user')
    case 'assistant':
      return wrapped(block.text, width, 'plain')
    case 'tool':
      return toolLines(block, width)
    case 'notice':
      return prefixed('· ', block.text, width, noticeTone(block.level))
  }
}

const conversationLines = (state: TuiState, width: number): ReadonlyArray<DisplayLine> => [
  ...state.conversation.blocks.flatMap((block) => blockLines(block, width)),
  ...(state.conversation.live === '' ? [] : wrapped(state.conversation.live, width, 'live')),
]

const hintOf = (conversation: Conversation): string => {
  if (conversation.approval !== undefined) return 'approval: y/n'
  if (conversation.ask !== undefined) return 'question: Enter'
  return conversation.running ? 'working…' : 'idle'
}

const statusLine = (state: TuiState, width: number): DisplayLine => {
  const left = clipText(plainText(state.title), width)
  const hint = hintOf(state.conversation)
  const gap = Math.max(1, width - displayWidth(left) - displayWidth(hint))
  return { text: clipText(left + ' '.repeat(gap) + hint, width), tone: 'title' }
}

interface Prompt {
  readonly prefix: string
  readonly tone: Tone
  readonly modal: boolean
}

const promptOf = (conversation: Conversation): Prompt => {
  if (conversation.approval !== undefined) {
    return {
      prefix: '⚠ approve ' + conversation.approval.tool + '? [y/n] ',
      tone: 'warn',
      modal: true,
    }
  }
  return conversation.ask !== undefined
    ? { prefix: '? ', tone: 'ask', modal: false }
    : { prefix: '› ', tone: 'plain', modal: false }
}

const inputLine = (state: TuiState, width: number): { line: DisplayLine; column: number } => {
  const prompt = promptOf(state.conversation)
  const text = prompt.modal ? '' : plainText(state.editor.text)
  const before = prompt.modal
    ? prompt.prefix
    : prompt.prefix + plainText(state.editor.text.slice(0, state.editor.cursor))
  return {
    line: { text: clipText(prompt.prefix + text, width), tone: prompt.tone },
    column: Math.max(0, Math.min(width - 1, displayWidth(before))),
  }
}

/** Builds a full screen: status, conversation tail, input, and a cursor position. */
export const render = (state: TuiState, size: Size, options?: RenderOptions): Screen => {
  const color = options?.color ?? true
  const columns = Math.max(20, size.columns)
  const rows = Math.max(3, size.rows)
  const content = conversationLines(state, columns)
  const bodyRows = rows - 2
  const tail = content.slice(Math.max(0, content.length - bodyRows))
  const blank: DisplayLine = { text: '', tone: 'plain' }
  const blanks = Array.from({ length: bodyRows - tail.length }, () => blank)
  const input = inputLine(state, columns)
  const display = [statusLine(state, columns), ...blanks, ...tail, input.line]
  return {
    lines: display.map((line) => paint({ ...line, text: clipText(line.text, columns) }, color)),
    cursor: { row: rows - 1, column: input.column },
  }
}

/** The bytes that repaint the whole screen and park the cursor. */
export const screenText = (screen: Screen): string =>
  '\u001b[H' +
  screen.lines.map((line) => line + '\u001b[K').join('\r\n') +
  '\u001b[' +
  String(screen.cursor.row + 1) +
  ';' +
  String(screen.cursor.column + 1) +
  'H'
