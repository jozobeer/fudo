import { configPaths } from './config.ts'
import { listSecrets, removeSecret, writeSecret } from './secrets-file.ts'

export interface AuthIo {
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
  /** Reads one secret; a terminal hides what is typed. */
  readonly readLine: (prompt: string) => Promise<string>
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

const usage = (io: AuthIo): number => {
  io.stderr('fudo auth set NAME     read one secret and store it\n')
  io.stderr('fudo auth list         show which names are stored\n')
  io.stderr('fudo auth remove NAME  forget one secret\n')
  return 2
}

/**
 * Keeps secrets out of shell history: the value is read from the terminal (or
 * from stdin) and written to the secrets file, never echoed back.
 */
export async function runAuth(
  argv: ReadonlyArray<string>,
  io: AuthIo,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const paths = configPaths(env)
  const command = argv[0] ?? ''

  if (command === 'set') {
    const name = argv[1] ?? ''
    if (!NAME.test(name)) return usage(io)
    const value = (await io.readLine(name + ': ')).trim()
    if (value === '') {
      io.stderr('fudo: nothing was read, so nothing was stored\n')
      return 2
    }
    writeSecret(paths.secrets, name, value)
    io.stdout('fudo: stored ' + name + ' in ' + paths.secrets + '\n')
    return 0
  }

  if (command === 'list') {
    const names = listSecrets(paths.secrets)
    io.stdout(names.length === 0 ? 'fudo: no secrets stored\n' : names.join('\n') + '\n')
    return 0
  }

  if (command === 'remove') {
    const name = argv[1] ?? ''
    if (!NAME.test(name)) return usage(io)
    const removed = removeSecret(paths.secrets, name)
    io.stdout(removed ? 'fudo: removed ' + name + '\n' : 'fudo: ' + name + ' was not stored\n')
    return removed ? 0 : 1
  }

  return usage(io)
}
