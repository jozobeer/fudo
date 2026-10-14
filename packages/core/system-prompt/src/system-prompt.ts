import { Tools } from '@fudo/tools'
import { Context, Effect, Layer, type Scope } from 'effect'
import { builtinSections, type BuiltinOptions } from './builtin.ts'
import { PromptError, type AssembleContext, type PromptBuild, type PromptSection } from './types.ts'

export interface SystemPromptShape {
  /** Registers a section until the surrounding scope closes. Duplicate names fail. */
  section(section: PromptSection): Effect.Effect<void, PromptError, Scope.Scope>
  sections(): ReadonlyArray<PromptSection>
  render(context: AssembleContext): Effect.Effect<string, PromptError>
  /** The system text plus the model-facing tools of the current context. */
  build(context: AssembleContext): Effect.Effect<PromptBuild, PromptError, Tools>
}

const VARIABLE = /\{\{([A-Za-z0-9_-]+)\}\}/g

const compareSections = (left: PromptSection, right: PromptSection): number => {
  if (left.order !== right.order) return left.order - right.order
  if (left.name === right.name) return 0
  return left.name < right.name ? -1 : 1
}

const interpolate = (
  text: string,
  context: AssembleContext,
): Effect.Effect<string, PromptError> => {
  const missing: Array<string> = []
  const rendered = text.replace(VARIABLE, (_match: string, name: string) => {
    const value = context.variables[name]
    if (value === undefined) {
      missing.push(name)
      return `{{${name}}}`
    }
    return value
  })
  return missing.length === 0
    ? Effect.succeed(rendered)
    : Effect.fail(
        new PromptError({
          code: 'unknown-variable',
          message: `unknown prompt variables: ${missing.join(', ')}`,
        }),
      )
}

/** Builds an in-memory prompt section registry. */
export function makeSystemPrompt(): SystemPromptShape {
  const registered = new Map<string, PromptSection>()

  const render = (context: AssembleContext): Effect.Effect<string, PromptError> =>
    Effect.gen(function* () {
      const complete = [...registered.values()].filter((section) => section.complete === true)
      if (complete.length > 1) {
        return yield* Effect.fail(
          new PromptError({
            code: 'multiple-complete',
            message: `complete prompt sections: ${complete.map((section) => section.name).join(', ')}`,
          }),
        )
      }
      const chosen =
        complete[0] !== undefined ? complete : [...registered.values()].sort(compareSections)
      const texts: Array<string> = []
      for (const section of chosen) {
        const raw = typeof section.text === 'function' ? section.text(context) : section.text
        // A section may render nothing: the tool guidance does when no visible tool has any.
        const text = yield* interpolate(raw, context)
        if (text !== '') texts.push(text)
      }
      return texts.join('\n\n')
    })

  return {
    section: (section) =>
      Effect.gen(function* () {
        if (registered.has(section.name)) {
          return yield* Effect.fail(
            new PromptError({
              code: 'duplicate-section',
              message: `prompt section ${section.name} is already registered`,
            }),
          )
        }
        registered.set(section.name, section)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (registered.get(section.name) === section) registered.delete(section.name)
          }),
        )
      }),

    sections: () => [...registered.values()],

    render,

    build: (context) =>
      Effect.gen(function* () {
        const tools = yield* Tools
        const schemas = tools.schemas()
        return { system: yield* render({ ...context, tools: schemas }), tools: schemas }
      }),
  }
}

/** Prompt registry of the application. */
export class SystemPrompt extends Context.Service<SystemPrompt, SystemPromptShape>()(
  'fudo/SystemPrompt',
) {}

/**
 * The registry the application runs with: a fresh registry that already holds the
 * built-in sections. A duplicate built-in name is a programming error, not input.
 */
export const systemPromptLayerWith = (options: BuiltinOptions = {}): Layer.Layer<SystemPrompt> =>
  Layer.effect(
    SystemPrompt,
    Effect.gen(function* () {
      const prompt = makeSystemPrompt()
      for (const section of builtinSections(options)) yield* prompt.section(section)
      return prompt
    }).pipe(Effect.orDie),
  )

export const systemPromptLayer: Layer.Layer<SystemPrompt> = systemPromptLayerWith()
