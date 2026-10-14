import { Schema } from 'effect'
import type { Plugin } from './plugin.ts'

/** The parts of a JSON Schema this rendering reads; anything else reads as "any". */
interface SchemaNode {
  readonly type?: string
  readonly enum?: ReadonlyArray<unknown>
  readonly items?: SchemaNode
  readonly anyOf?: ReadonlyArray<SchemaNode>
  readonly oneOf?: ReadonlyArray<SchemaNode>
}

interface ObjectNode extends SchemaNode {
  readonly properties?: Readonly<Record<string, SchemaNode>>
  readonly required?: ReadonlyArray<string>
}

/** The words a person writes for each JSON Schema type. */
const TYPE_TEXT: Readonly<Record<string, string>> = {
  string: 'string',
  integer: 'integer',
  number: 'number',
  boolean: 'true or false',
  object: 'object',
  null: 'null',
}

const scalarText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value)

/** Array and union nodes spell out their parts; every other node is one word. */
const partsText = (node: SchemaNode): string | undefined => {
  if (node.type === 'array') return typeText(node.items) + '[]'
  const branches = node.anyOf ?? node.oneOf
  return branches === undefined ? undefined : branches.map(typeText).join(' or ')
}

/** What a person may write for one key: a type, or the values an enum allows. */
const typeText = (node: SchemaNode | undefined): string => {
  const shape = node ?? {}
  if (shape.enum !== undefined) return 'one of ' + shape.enum.map(scalarText).join('|')
  return partsText(shape) ?? TYPE_TEXT[shape.type ?? ''] ?? 'any'
}

const propertyText = (name: string, node: SchemaNode, required: ReadonlySet<string>): string =>
  name + ' (' + (required.has(name) ? 'required' : 'optional') + ', ' + typeText(node) + ')'

const pluginLine = (plugin: Plugin<any, any, any>): string => {
  const document = Schema.toJsonSchemaDocument(plugin.config)
  const schema = document.schema as ObjectNode
  const properties = schema.properties ?? {}
  const names = Object.keys(properties)
  if (names.length === 0) return '  - ' + plugin.name + ': none'
  const required = new Set(schema.required ?? [])
  const keys = names.map((name) => propertyText(name, properties[name]!, required))
  return '  - ' + plugin.name + ': ' + keys.join(', ')
}

/**
 * One line per registered plugin: the config keys its schema declares. A reader
 * learns what a row may carry without reading the plugin, and the line follows
 * the schema the loader decodes, so the two cannot drift.
 */
export function renderPluginKeys(plugins: ReadonlyArray<Plugin<any, any, any>>): string {
  const lines = [...plugins].sort((left, right) => left.name.localeCompare(right.name))
  return (
    [
      "config keys (from each plugin's schema; keys it does not declare are ignored):",
      ...lines.map(pluginLine),
    ].join('\n') + '\n'
  )
}
