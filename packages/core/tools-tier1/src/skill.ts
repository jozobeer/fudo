import { Schema, Effect } from 'effect'
import { ToolError, type ToolDefinition } from '@fudo/tools'

const Parameters = Schema.Struct({ name: Schema.String })

export type SkillArgs = Schema.Schema.Type<typeof Parameters>

export interface SkillValue {
  readonly name: string
  readonly path: string
  readonly body: string
}

const NAME = /^[a-z0-9][a-z0-9-]*$/

const readIfPresent = (path: string): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const file = Bun.file(path)
    if (!(yield* Effect.promise(() => file.exists()))) return undefined
    return yield* Effect.promise(() => file.text())
  })

/** Reads one skill's SKILL.md from the first root that has it. */
export const makeSkillTool = (
  roots: ReadonlyArray<string>,
): ToolDefinition<SkillArgs, SkillValue> => ({
  name: 'skill',
  description: 'Reads one skill by name from the skill directories.',
  parameters: Parameters,
  needs: ['read'],
  output: {
    schema: Schema.Struct({ name: Schema.String, path: Schema.String, body: Schema.String }),
    render: (_args, value) => [{ type: 'text', text: value.body }],
  },
  execute: (args) =>
    Effect.gen(function* () {
      if (!NAME.test(args.name)) {
        return yield* Effect.fail(
          new ToolError({
            code: 'invalid-arguments',
            message: 'a skill name is lower-case letters, digits, and dashes: ' + args.name,
          }),
        )
      }
      for (const root of roots) {
        const path = root + '/' + args.name + '/SKILL.md'
        const body = yield* readIfPresent(path)
        if (body !== undefined) return { name: args.name, path, body }
      }
      return yield* Effect.fail(
        new ToolError({ code: 'execution', message: 'unknown skill: ' + args.name }),
      )
    }),
})
