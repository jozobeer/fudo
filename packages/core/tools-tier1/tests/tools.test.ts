import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'
import { makeAsk } from '@jozo-harness/safety'
import { tier1Tools } from '../src/index.ts'

describe('tier1Tools', () => {
  test('lists the tier 1 tools with the installed ask holder', async () => {
    const ask = await Effect.runPromise(makeAsk())
    const tools = tier1Tools(ask)

    expect(tools.map((tool) => tool.name)).toEqual([
      'todo_write',
      'ask_user',
      'web_fetch',
      'read_image',
    ])
  })
})
