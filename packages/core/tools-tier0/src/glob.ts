import { Schema, Effect } from 'effect'
import { ToolError, type ToolDefinition } from '@fudo/tools'

const Parameters = Schema.Struct({
  pattern: Schema.String,
  limit: Schema.optionalKey(Schema.Int),
})

export type GlobArgs = Schema.Schema.Type<typeof Parameters>

export interface GlobValue {
  readonly files: ReadonlyArray<string>
  readonly truncated: boolean
}

/** Lists workspace files whose relative path matches a glob, sorted. */
export const globTool: ToolDefinition<GlobArgs, GlobValue> = {
  name: 'glob',
  description: 'Lists workspace files matching a glob pattern, sorted by path.',
  parameters: Parameters,
  needs: ['read'],
  output: {
    schema: Schema.Struct({ files: Schema.Array(Schema.String), truncated: Schema.Boolean }),
    render: (_args, value) => [
      { type: 'text', text: value.files.join('\n') + (value.truncated ? '\n...' : '') },
    ],
  },
  execute: (args, context) =>
    Effect.gen(function* () {
      const limit = args.limit ?? 1000
      const listed = yield* Effect.tryPromise({
        try: async () => {
          const glob = new Bun.Glob(args.pattern)
          const files: Array<string> = []
          for await (const file of glob.scan({ cwd: context.cwd, dot: false })) {
            files.push(file)
            if (files.length > limit) break
          }
          files.sort()
          return files
        },
        catch: () => new ToolError({ code: 'execution', message: 'cannot scan ' + args.pattern }),
      })
      return { files: listed.slice(0, limit), truncated: listed.length > limit }
    }),
}
