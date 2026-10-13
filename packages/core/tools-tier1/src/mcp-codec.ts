/** One JSON-RPC message on an MCP stdio stream, one per line. */
export interface McpRequest {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly method: string
  readonly params?: unknown
}

export interface McpResponse {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string }
}

/** One request as a line, ready to write to the server's stdin. */
export const encodeRequest = (id: number, method: string, params?: unknown): string =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    ...(params === undefined ? {} : { params }),
  }) + '\n'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A response line, or nothing when the line is a notification or is malformed. */
export const decodeResponse = (line: string): McpResponse | undefined => {
  const text = line.trim()
  if (text === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  if (parsed.jsonrpc !== '2.0') return undefined
  if (typeof parsed.id !== 'number') return undefined
  const error = isRecord(parsed.error)
    ? { code: Number(parsed.error.code ?? 0), message: String(parsed.error.message ?? '') }
    : undefined
  return error === undefined
    ? { jsonrpc: '2.0', id: parsed.id, result: parsed.result }
    : { jsonrpc: '2.0', id: parsed.id, error }
}

/** The MCP handshake and the two calls v1 uses. */
export const INITIALIZE = 'initialize'
export const TOOLS_LIST = 'tools/list'
export const TOOLS_CALL = 'tools/call'
