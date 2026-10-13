import { runAuth } from './auth.ts'

type EditKey = 'submit' | 'interrupt' | 'backspace'

/** Terminal keys that end or edit the hidden line; anything else is text. */
const EDIT_KEYS: Readonly<Record<string, EditKey | undefined>> = {
  '\r': 'submit',
  '\n': 'submit',
  '\u0003': 'interrupt',
  '\u007f': 'backspace',
  '\b': 'backspace',
}

/** Reads one secret: hidden on a terminal, all of stdin when piped. */
export const readHiddenLine = async (prompt: string): Promise<string> => {
  const input = process.stdin
  if (input.isTTY !== true) {
    input.setEncoding('utf8')
    let text = ''
    for await (const chunk of input) text += String(chunk)
    return text
  }
  process.stderr.write(prompt)
  input.setRawMode(true)
  input.resume()
  input.setEncoding('utf8')
  return await new Promise<string>((resolve) => {
    let value = ''
    const finish = (result: string) => {
      input.setRawMode(false)
      input.pause()
      input.off('data', onData)
      process.stderr.write('\n')
      resolve(result)
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        const key = EDIT_KEYS[char]
        if (key === 'submit') {
          finish(value)
          return
        }
        if (key === 'interrupt') {
          process.stderr.write('\n')
          process.exit(130)
        }
        value = key === 'backspace' ? value.slice(0, -1) : value + char
      }
    }
    input.on('data', onData)
  })
}

/** Handles the auth subcommand before anything else; undefined means "not mine". */
export async function runAuthAtStart(argv: ReadonlyArray<string>): Promise<number | undefined> {
  if (argv[0] !== 'auth') return undefined
  return await runAuth(argv.slice(1), {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    readLine: readHiddenLine,
  })
}
