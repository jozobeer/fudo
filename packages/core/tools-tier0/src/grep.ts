import { Schema, Effect } from 'effect'
import { ToolError, type ToolDefinition } from '@fudo/tools'
import { isBinary, walkFiles } from './walk.ts'

/**
 * A search stops here. Well above what one message can hold, so a big result
 * reaches the model through the spill locator instead of being cut off here.
 */
export const GREP_MAX_MATCHES = 20_000
/** The most files one search looks through before it stops. */
export const GREP_MAX_FILES = 20_000

const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({
    description: 'A JavaScript regular expression to search for in each line.',
  }),
  include: Schema.optionalKey(
    Schema.String.annotate({
      description: "A glob that limits which files are read, for example 'src/**/*.ts'.",
    }),
  ),
  limit: Schema.optionalKey(
    Schema.Int.annotate({ description: 'The most matches to return. Defaults to 20000.' }),
  ),
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

/** One file's matching lines, in order. */
const matchesIn = (file: string, text: string, expression: RegExp): ReadonlyArray<GrepMatch> => {
  const matches: Array<GrepMatch> = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (expression.test(line)) matches.push({ file, line: index + 1, text: line })
  }
  return matches
}

/** A file's text, or undefined when it is binary or not UTF-8; either way it has no lines to match. */
const searchableText = async (path: string): Promise<string | undefined> => {
  const bytes = await Bun.file(path)
    .arrayBuffer()
    .then(
      (buffer) => new Uint8Array(buffer),
      () => undefined,
    )
  if (bytes === undefined || isBinary(bytes)) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** Walks the files in order and stops one match past the limit, which is all the caller needs. */
const findMatches = async (
  files: ReadonlyArray<string>,
  cwd: string,
  expression: RegExp,
  limit: number,
): Promise<Array<GrepMatch>> => {
  const matches: Array<GrepMatch> = []
  for (const file of files) {
    if (matches.length > limit) break
    const text = await searchableText(cwd + '/' + file)
    if (text === undefined) continue
    matches.push(...matchesIn(file, text, expression))
  }
  return matches
}

const compile = (pattern: string): Effect.Effect<RegExp, ToolError> =>
  Effect.try({
    try: () => new RegExp(pattern),
    catch: () => new ToolError({ code: 'invalid-arguments', message: 'bad pattern: ' + pattern }),
  })

/** Searches workspace files line by line with a regular expression. */
export const grepTool: ToolDefinition<GrepArgs, GrepValue> = {
  name: 'grep',
  description:
    'Searches workspace files for a regular expression and returns file, line, and text for each match. Use it instead of shelling out to grep or rg. node_modules, .git, hidden paths, and binary files are skipped.',
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
            .join('\n') +
          (value.truncated
            ? '\n... (stopped at ' +
              String(value.matches.length) +
              ' matches; narrow the pattern to see the rest)'
            : ''),
      },
    ],
  },
  execute: (args, context) =>
    Effect.gen(function* () {
      // The pattern is compiled before a single file is read.
      const expression = yield* compile(args.pattern)
      const limit = args.limit ?? GREP_MAX_MATCHES
      if (limit < 1) {
        return yield* Effect.fail(
          new ToolError({ code: 'invalid-arguments', message: 'limit starts at 1' }),
        )
      }
      const files = yield* walkFiles({
        cwd: context.cwd,
        limit: GREP_MAX_FILES,
        ...(args.include === undefined ? {} : { pattern: args.include }),
      })
      const found = yield* Effect.promise(() => findMatches(files, context.cwd, expression, limit))
      return { matches: found.slice(0, limit), truncated: found.length > limit }
    }),
}
