import { Schema, Effect } from 'effect'
import { ToolError, type ToolDefinition } from '@fudo/tools'

const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: 'The file to read, absolute or relative to the working directory.',
  }),
  offset: Schema.optionalKey(
    Schema.Int.annotate({ description: 'First line to return, 1-based. Defaults to 1.' }),
  ),
  limit: Schema.optionalKey(
    Schema.Int.annotate({ description: 'How many lines to return. Defaults to 2000.' }),
  ),
})

export type ReadArgs = Schema.Schema.Type<typeof Parameters>

export interface ReadValue {
  readonly text: string
  readonly totalLines: number
}

const numbered = (lines: ReadonlyArray<string>, offset: number, limit: number): string =>
  lines
    .slice(offset - 1, offset - 1 + limit)
    .map((line, index) => String(offset + index) + '\t' + line)
    .join('\n')

/** Reads one UTF-8 text file. Line numbers are 1-based, like an editor. */
export const readTool: ToolDefinition<ReadArgs, ReadValue> = {
  name: 'read',
  description:
    'Reads a UTF-8 text file and returns its lines with 1-based line numbers. Use it instead of cat, head, or tail; page through a long file with offset and limit.',
  parameters: Parameters,
  needs: ['read'],
  output: {
    schema: Schema.Struct({ text: Schema.String, totalLines: Schema.Int }),
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  execute: (args, context) =>
    Effect.gen(function* () {
      const path = args.path.startsWith('/') ? args.path : context.cwd + '/' + args.path
      const text = yield* Effect.tryPromise({
        try: () => Bun.file(path).text(),
        catch: () => new ToolError({ code: 'execution', message: 'cannot read ' + path }),
      })
      const lines = text.split('\n')
      if (lines[lines.length - 1] === '') lines.pop()
      const offset = args.offset ?? 1
      const limit = args.limit ?? 2000
      return { text: numbered(lines, offset, limit), totalLines: lines.length }
    }),
}
