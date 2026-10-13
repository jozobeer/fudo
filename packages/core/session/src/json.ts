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

/** Whether a value survives a JSON round trip without losing information. */
export function isJsonValue(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (value === null) return true
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true
    case 'number':
      return Number.isFinite(value)
    case 'object': {
      if (seen.has(value)) return false
      seen.add(value)
      if (Array.isArray(value)) return value.every((member) => isJsonValue(member, seen))
      if (!isPlainObject(value)) return false
      return Object.values(value).every((member) => isJsonValue(member, seen))
    }
    default:
      return false
  }
}
