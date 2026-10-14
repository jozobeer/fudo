import { Schema, Effect } from 'effect'
import { ToolError, type ToolDefinition } from '@fudo/tools'
import { walkFiles } from './walk.ts'

/** A listing stops here; a bigger workspace is reached by narrowing the pattern. */
export const GLOB_MAX_PATHS = 20_000

const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({
    description: "The glob to match against workspace paths, for example '**/*.ts'.",
  }),
  limit: Schema.optionalKey(
    Schema.Int.annotate({ description: 'The most paths to return. Defaults to 20000.' }),
  ),
})

export type GlobArgs = Schema.Schema.Type<typeof Parameters>

export interface GlobValue {
  readonly files: ReadonlyArray<string>
  readonly truncated: boolean
}

/** Lists workspace files whose relative path matches a glob, sorted. Ignored and hidden paths are not walked. */
export const globTool: ToolDefinition<GlobArgs, GlobValue> = {
  name: 'glob',
  presentCall: (args) => ({ summary: 'glob ' + args.pattern }),
  description:
    'Lists workspace files matching a glob pattern, sorted by path. Use it to find files by name; use grep to search inside them. node_modules and .git are never walked.',
  parameters: Parameters,
  needs: ['read'],
  output: {
    schema: Schema.Struct({ files: Schema.Array(Schema.String), truncated: Schema.Boolean }),
    render: (_args, value) => [
      {
        type: 'text',
        text:
          value.files.join('\n') +
          (value.truncated
            ? '\n... (stopped at ' +
              String(value.files.length) +
              ' paths; narrow the pattern to see the rest)'
            : ''),
      },
    ],
  },
  execute: (args, context) =>
    Effect.gen(function* () {
      const limit = args.limit ?? GLOB_MAX_PATHS
      if (limit < 1) {
        return yield* Effect.fail(
          new ToolError({ code: 'invalid-arguments', message: 'limit starts at 1' }),
        )
      }
      // One path past the limit is enough to know the listing was cut.
      const files = yield* walkFiles({ cwd: context.cwd, limit: limit + 1, pattern: args.pattern })
      return { files: files.slice(0, limit), truncated: files.length > limit }
    }),
}
