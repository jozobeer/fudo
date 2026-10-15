import { oneLine } from '@jozo-harness/tools'

/** `read src/app.ts:10-40`, or just the path when the whole file was meant. */
export const rangeOf = (args: {
  readonly path: string
  readonly offset?: number
  readonly limit?: number
}): string => {
  if (args.offset === undefined && args.limit === undefined) return args.path
  const from = args.offset ?? 1
  // \`src/app.ts:10+\` reads as "from line 10 on", which is what an offset alone asks for.
  return (
    args.path +
    ':' +
    String(from) +
    (args.limit === undefined ? '+' : '-' + String(from + args.limit - 1))
  )
}

const linesIn = (text: string): number => (text === '' ? 0 : text.split('\n').length)

/** `+3 -1`: how the replacement changes the line count, the way a diff says it. */
export const changedLines = (args: {
  readonly oldString: string
  readonly newString: string
  readonly all?: boolean
}): string =>
  'lines: ' +
  String(linesIn(args.oldString)) +
  ' → ' +
  String(linesIn(args.newString)) +
  (args.all === true ? ' (all)' : '')

/** The exit code a bash result carries, as one line: the rest is in the result itself. */
export const exitSummaryOf = (summary: string): string => {
  const code = /\[exit code: (\d+)\]/.exec(summary)?.[1]
  if (code === undefined) return oneLine(summary).slice(0, 120)
  if (code === '0') return 'exit 0'
  const timedOut = /\[timed out after (\d+)ms\]/.exec(summary)?.[1]
  return timedOut === undefined ? 'exit ' + code : 'exit ' + code + ' after ' + timedOut + 'ms'
}
