import { Schema, Effect } from 'effect'
import { ToolError, type ToolDefinition } from '@jozo-harness/tools'
import { discoverSkills, parseSkillDocument } from './skills.ts'

const Parameters = Schema.Struct({
  name: Schema.String.annotate({
    description: 'The exact skill name from the available-skills catalog.',
  }),
})

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

const availableIn = (names: ReadonlyArray<string>): string =>
  names.length === 0 ? '' : ' (available: ' + names.join(', ') + ')'

/**
 * Reads one skill's SKILL.md from the first root that holds it. The roots are
 * searched again on every call, so the tool and the published catalog cannot
 * drift apart, and the model never contributes to a path.
 */
export const makeSkillTool = (
  roots: ReadonlyArray<string>,
): ToolDefinition<SkillArgs, SkillValue> => ({
  name: 'skill',
  description:
    'Reads the full instructions of one skill by name. Call it before acting on a task that names a skill or clearly matches one in the catalog.',
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
      const skills = yield* discoverSkills(roots)
      const match = skills.find((skill) => skill.name === args.name)
      if (match === undefined) {
        return yield* Effect.fail(
          new ToolError({
            code: 'execution',
            message: 'unknown skill: ' + args.name + availableIn(skills.map((skill) => skill.name)),
          }),
        )
      }
      const text = yield* readIfPresent(match.path)
      const document = text === undefined ? undefined : parseSkillDocument(text)
      if (document === undefined) {
        return yield* Effect.fail(
          new ToolError({
            code: 'execution',
            message: 'the skill file changed since it was listed: ' + match.path,
          }),
        )
      }
      // The model reads the instructions, not the metadata it already saw listed.
      return { name: document.name, path: match.path, body: document.body }
    }),
})
