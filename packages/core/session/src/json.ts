/** A value the session log can store losslessly. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Whether a value survives a JSON round trip without losing information.
 *
 * `path` holds the ancestors currently being visited, so a shared reference is
 * valid and only a true cycle is rejected.
 */
export function isJsonValue(value: unknown, path: WeakSet<object> = new WeakSet()): boolean {
  if (value === null) return true
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true
    case 'number':
      return Number.isFinite(value)
    case 'object': {
      if (path.has(value)) return false
      path.add(value)
      const valid = Array.isArray(value)
        ? value.every((member) => isJsonValue(member, path))
        : isPlainObject(value) && Object.values(value).every((member) => isJsonValue(member, path))
      path.delete(value)
      return valid
    }
    default:
      return false
  }
}
