import { describe, expect, test } from 'vitest'
import { decodeResponse, encodeRequest, TOOLS_CALL } from '../src/index.ts'

describe('encodeRequest', () => {
  test('writes one line of JSON-RPC', () => {
    const line = encodeRequest(1, TOOLS_CALL, { name: 'echo', arguments: {} })

    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'echo', arguments: {} },
    })
  })

  test('leaves params out when there are none', () => {
    expect(JSON.parse(encodeRequest(2, 'tools/list'))).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
  })
})

describe('decodeResponse', () => {
  test('reads a result', () => {
    expect(decodeResponse('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [] },
    })
  })

  test('reads an error', () => {
    expect(
      decodeResponse('{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"nope"}}'),
    ).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32601, message: 'nope' },
    })
  })

  test('ignores notifications and malformed lines', () => {
    expect(decodeResponse('{"jsonrpc":"2.0","method":"notifications/progress"}')).toBeUndefined()
    expect(decodeResponse('not json')).toBeUndefined()
    expect(decodeResponse('')).toBeUndefined()
  })
})
