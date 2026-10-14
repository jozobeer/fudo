import type { ToolSchema } from '@fudo/llm'

/** How short a tool description may be before it stops explaining the tool. */
const MIN_DESCRIPTION = 40

const asObject = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined

/**
 * Every named parameter at this level, dotted through the objects under it, with
 * the parameters of an array's item object named `name[]`.
 */
const propertiesOf = (
  parameters: Readonly<Record<string, unknown>>,
  prefix = '',
): ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> => {
  const properties = asObject(parameters['properties'])
  if (properties === undefined) return []
  return Object.entries(properties).flatMap(([name, value]) => {
    const property = asObject(value)
    if (property === undefined) return []
    const path = prefix === '' ? name : prefix + '.' + name
    const item = asObject(property['items'])
    return [
      [path, property] as const,
      ...propertiesOf(property, path),
      ...(item === undefined ? [] : propertiesOf(item, path + '[]')),
    ]
  })
}

/**
 * Everything about a model-facing declaration that leaves the model without a
 * meaning: a tool it cannot place, or a parameter it cannot use. Empty is good,
 * so a test can require that of every tool the harness ships.
 */
export function toolSchemaIssues(declaration: ToolSchema): ReadonlyArray<string> {
  const issues: Array<string> = []
  if (declaration.description.trim().length < MIN_DESCRIPTION) {
    issues.push(declaration.name + ': the description does not say what the tool is for')
  }
  for (const [name, property] of propertiesOf(declaration.parameters)) {
    const description = property['description']
    if (typeof description !== 'string' || description.trim() === '') {
      issues.push(declaration.name + '.' + name + ': the parameter has no description')
    }
  }
  return issues
}
