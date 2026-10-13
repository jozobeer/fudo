import { Schema, Effect } from 'effect'
import { ToolError, type ToolDefinition } from '@fudo/tools'

const Parameters = Schema.Struct({
  pattern: Schema.String,
  include: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.Int),
})

export type GrepArgs = Schema.Schema.Type<typeof Parameters>

export interface GrepMatch {
  readonly file: string
  readonly line: number
  readonly text: string
}

export interface GrepValue {
  readonly matches: ReadonlyArray<GrepMatch>
  readonly truncated: boolean
}

/** Searches workspace files line by line with a regular expression. */
export const grepTool: ToolDefinition<GrepArgs, GrepValue> = {
  name: 'grep',
  description: 'Searches workspace files for a regular expression, one match per line.',
  parameters: Parameters,
  needs: ['read'],
  output: {
    schema: Schema.Struct({
      matches: Schema.Array(
        Schema.Struct({ file: Schema.String, line: Schema.Int, text: Schema.String }),
      ),
      truncated: Schema.Boolean,
    }),
    render: (_args, value) => [
      {
        type: 'text',
        text:
          value.matches
            .map((match) => match.file + ':' + String(match.line) + ': ' + match.text)
            .join('\n') + (value.truncated ? '\n...' : ''),
      },
    ],
  },
  execute: (args, context) =>
    Effect.gen(function* () {
      const expression = yield* Effect.try({
        try: () => new RegExp(args.pattern),
        catch: () =>
          new ToolError({ code: 'invalid-arguments', message: 'bad pattern: ' + args.pattern }),
      })
      const limit = args.limit ?? 200
      const found = yield* Effect.tryPromise({
        try: async () => {
          const glob = new Bun.Glob(args.include ?? '**/*')
          const matches: Array<GrepMatch> = []
          for await (const file of glob.scan({ cwd: context.cwd, dot: false })) {
            const path = context.cwd + '/' + file
            const text = await Bun.file(path)
              .text()
              .catch(() => '')
            const lines = text.split('\n')
            for (let index = 0; index < lines.length; index += 1) {
              const line = lines[index] ?? ''
              if (expression.test(line)) matches.push({ file, line: index + 1, text: line })
              if (matches.length > limit) return matches
            }
          }
          return matches
        },
        catch: () => new ToolError({ code: 'execution', message: 'cannot search the workspace' }),
      })
      return { matches: found.slice(0, limit), truncated: found.length > limit }
    }),
}
