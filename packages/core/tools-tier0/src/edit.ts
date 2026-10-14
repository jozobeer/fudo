import { Schema, Effect } from 'effect'
import { ToolError, type ToolDefinition } from '@fudo/tools'
import { resolveInside } from './write.ts'

const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: 'The file to change, absolute or relative to the working directory.',
  }),
  oldString: Schema.String.annotate({
    description: 'The exact text to replace. It must appear exactly once unless all is true.',
  }),
  newString: Schema.String.annotate({ description: 'The text to put in its place.' }),
  all: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        'Replace every occurrence instead of refusing an ambiguous match. Defaults to false.',
    }),
  ),
})

export type EditArgs = Schema.Schema.Type<typeof Parameters>

export interface EditValue {
  readonly path: string
  readonly replacements: number
}

const countOf = (text: string, needle: string): number => {
  let count = 0
  let index = text.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = text.indexOf(needle, index + needle.length)
  }
  return count
}

/** Replaces text in one file. Without \`all\`, the old text must be unique. */
export const editTool: ToolDefinition<EditArgs, EditValue> = {
  name: 'edit',
  description:
    'Replaces text in one workspace file and leaves the rest of it alone. Use it for a targeted change; use write to replace a whole file.',
  parameters: Parameters,
  needs: ['write'],
  output: {
    schema: Schema.Struct({ path: Schema.String, replacements: Schema.Int }),
    render: (_args, value) => [
      {
        type: 'text',
        text: 'edited ' + value.path + ' (' + String(value.replacements) + ' replacements)',
      },
    ],
  },
  execute: (args, context) =>
    Effect.gen(function* () {
      const path = yield* resolveInside(context.cwd, args.path)
      const text = yield* Effect.tryPromise({
        try: () => Bun.file(path).text(),
        catch: () => new ToolError({ code: 'execution', message: 'cannot read ' + path }),
      })
      const found = countOf(text, args.oldString)
      if (found === 0) {
        return yield* Effect.fail(
          new ToolError({ code: 'execution', message: 'no match for the old text in ' + path }),
        )
      }
      const all = args.all === true
      if (found > 1 && !all) {
        return yield* Effect.fail(
          new ToolError({
            code: 'execution',
            message: String(found) + ' matches in ' + path + '; pass all to replace every one',
          }),
        )
      }
      const updated = all
        ? text.split(args.oldString).join(args.newString)
        : text.replace(args.oldString, args.newString)
      const written = yield* Effect.tryPromise({
        try: async () => {
          await Bun.write(path, updated)
          return true
        },
        catch: () => new ToolError({ code: 'execution', message: 'cannot write ' + path }),
      })
      void written
      return { path, replacements: all ? found : 1 }
    }),
}
