import { Schema, Effect } from 'effect'
import { ToolError, type ToolDefinition } from '@fudo/tools'
import { noneSandbox, type SandboxShape } from '@fudo/safety'
import { resolveInside } from './write.ts'

const Parameters = Schema.Struct({
  command: Schema.String,
  cwd: Schema.optionalKey(Schema.String),
})

export type BashArgs = Schema.Schema.Type<typeof Parameters>

export interface BashValue {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const output = (value: BashValue): string =>
  value.stderr === '' ? value.stdout : value.stdout + value.stderr

/** Runs one shell command, wrapped by the sandbox the caller chose. */
export const makeBashTool = (
  sandbox: SandboxShape = noneSandbox,
): ToolDefinition<BashArgs, BashValue> => ({
  name: 'bash',
  description: 'Runs a shell command in the workspace through the configured sandbox.',
  parameters: Parameters,
  needs: ['exec'],
  output: {
    schema: Schema.Struct({
      exitCode: Schema.Int,
      stdout: Schema.String,
      stderr: Schema.String,
    }),
    render: (_args, value) => [{ type: 'text', text: output(value) }],
  },
  execute: (args, context) =>
    Effect.gen(function* () {
      const cwd = args.cwd === undefined ? context.cwd : yield* resolveInside(context.cwd, args.cwd)
      const wrapped = yield* sandbox
        .wrap({ argv: ['bash', '-lc', args.command], cwd })
        .pipe(
          Effect.mapError(
            (error) => new ToolError({ code: 'execution', message: 'sandbox: ' + error.message }),
          ),
        )
      const ran = yield* Effect.tryPromise({
        try: async () => {
          const process = Bun.spawn({
            cmd: [...wrapped.argv],
            cwd: wrapped.cwd,
            stdout: 'pipe',
            stderr: 'pipe',
          })
          const stdout = await new Response(process.stdout).text()
          const stderr = await new Response(process.stderr).text()
          const exitCode = await process.exited
          return { exitCode, stdout, stderr }
        },
        catch: () => new ToolError({ code: 'execution', message: 'cannot run: ' + args.command }),
      })
      if (ran.exitCode !== 0) {
        return yield* Effect.fail(
          new ToolError({
            code: 'execution',
            message: 'exit ' + String(ran.exitCode) + ': ' + output(ran),
          }),
        )
      }
      return ran
    }),
})

export const bashTool = makeBashTool()
