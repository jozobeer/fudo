import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { Schema, Effect } from 'effect'
import { ToolError, type ToolDefinition } from '@fudo/tools'
import { guardWrite, look, type ObservedFiles } from './observed-files.ts'
import { normalizeNewlines } from './text.ts'

const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: 'The file to write, absolute or relative to the working directory.',
  }),
  content: Schema.String.annotate({ description: 'The complete new contents of the file.' }),
})

export type WriteArgs = Schema.Schema.Type<typeof Parameters>

export interface WriteValue {
  readonly path: string
  readonly bytes: number
}

/** Resolves `path` under `root`; anything escaping the root is refused. */
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

/**
 * Writes one UTF-8 text file, creating parent directories. A file that is already
 * there is written only when this session read it and nobody changed it since; a
 * refusal happens before anything on disk is touched.
 */
export const makeWriteTool = (observed: ObservedFiles): ToolDefinition<WriteArgs, WriteValue> => ({
  name: 'write',
  description:
    'Writes a UTF-8 text file inside the workspace, creating parent directories. Read a file before you overwrite it: write replaces the whole file.',
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
      yield* guardWrite(observed, context.sessionId, path)
      const content = normalizeNewlines(args.content)
      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(path), { recursive: true })
          await Bun.write(path, content)
        },
        catch: () => new ToolError({ code: 'execution', message: 'cannot write ' + path }),
      })
      const written = yield* look(path)
      if (written !== undefined) observed.observe(context.sessionId, path, written)
      return { path, bytes: new TextEncoder().encode(content).length }
    }),
})
