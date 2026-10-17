import { describe, expect, test } from 'vitest'
import { decodeSessionEvent } from '@jozo-harness/session'
import { Effect } from 'effect'
import { approvalEventSchemas } from '../src/index.ts'

describe('approval events', () => {
  test('registers both approval events in the catalog', () => {
    expect([...approvalEventSchemas.keys()]).toEqual([
      'safety/approval/requested',
      'safety/approval/answered',
    ])
  })

  test('a request decodes from the log', async () => {
    const event = await Effect.runPromise(
      decodeSessionEvent({
        seq: 2,
        time: 1,
        type: 'safety/approval/requested',
        data: { callId: 'c1', tool: 'bash', reason: 'preset read-only does not allow: exec' },
      }),
    )

    expect(event?.type).toBe('safety/approval/requested')
    expect(event?.type === 'safety/approval/requested' ? event.data.tool : '').toBe('bash')
  })

  test('a malformed request is rejected', async () => {
    const result = await Effect.runPromise(
      Effect.match(
        decodeSessionEvent({
          seq: 3,
          time: 1,
          type: 'safety/approval/answered',
          data: { callId: 'c1' },
        }),
        { onFailure: () => 'rejected', onSuccess: () => 'accepted' },
      ),
    )

    expect(result).toBe('rejected')
  })
})
