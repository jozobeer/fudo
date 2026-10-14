import { runConfig } from './config-command.ts'

/** Handles the config subcommand before anything else; undefined means "not mine". */
export async function runConfigAtStart(argv: ReadonlyArray<string>): Promise<number | undefined> {
  if (argv[0] !== 'config') return undefined
  return await runConfig(argv.slice(1), {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
  })
}
