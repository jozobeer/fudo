import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { Schema, Effect } from 'effect'
import { ToolError, type ToolDefinition } from '@fudo/tools'

const Parameters = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
})

export type WriteArgs = Schema.Schema.Type<typeof Parameters>

export interface WriteValue {
  readonly path: string
  readonly bytes: number
}

/** Resolves \`path\` under \`root\`; anything escaping the root is refused. */
export const resolveInside = (root: string, path: string): Effect.Effect<string, ToolError> => {
  const target = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const inside = relative(resolve(root), target)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    return Effect.fail(
      new ToolError({ code: 'denied', message: 'path escapes the workspace: ' + path }),
    )
  }
  return Effect.succeed(target)
}

/** Writes one UTF-8 text file, creating parent directories. */
export const writeTool: ToolDefinition<WriteArgs, WriteValue> = {
  name: 'write',
  description: 'Writes a UTF-8 text file inside the workspace, creating parent directories.',
  parameters: Parameters,
  needs: ['write'],
  output: {
    schema: Schema.Struct({ path: Schema.String, bytes: Schema.Int }),
    render: (_args, value) => [
      { type: 'text', text: 'wrote ' + value.path + ' (' + String(value.bytes) + ' bytes)' },
    ],
  },
  execute: (args, context) =>
    Effect.gen(function* () {
      const path = yield* resolveInside(context.cwd, args.path)
      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(path), { recursive: true })
          await Bun.write(path, args.content)
        },
        catch: () => new ToolError({ code: 'execution', message: 'cannot write ' + path }),
      })
      return { path, bytes: new TextEncoder().encode(args.content).length }
    }),
}
