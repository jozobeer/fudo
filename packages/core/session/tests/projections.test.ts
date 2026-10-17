import { describe, expect, test } from 'vitest'
import {
  SessionError,
  deriveMessages,
  registerLogOnlySessionEvents,
  registerMessageProjection,
  type DerivedMessage,
} from '../src/index.ts'
import { event, headerEvent } from './support.ts'

// A plugin's event types: declared here like a package would declare them.
declare module '../src/events.ts' {
  interface SessionEventMap {
    'test/unprojected': { readonly text: string }
    'test/log-only': { readonly text: string }
    'test/projected': { readonly text: string }
  }
}

registerLogOnlySessionEvents(['test/log-only'])
registerMessageProjection({
  type: 'test/projected',
  name: 'test/projected',
  project: (raw, derived: ReadonlyArray<DerivedMessage>) =>
    raw.type === 'test/projected'
      ? [
          ...derived,
          {
            seq: raw.seq,
            message: { role: 'user', content: [{ type: 'text', text: raw.data.text }] },
          },
        ]
      : derived,
})

describe('message projections', () => {
  test('an event type nobody projected or declared fails the read', () => {
    const events = [headerEvent(), event(2, 'test/unprojected', { text: 'lost' })]

    expect(() => deriveMessages(events)).toThrow(SessionError)
    expect(() => deriveMessages(events)).toThrow(/test\/unprojected/)
  })

  test('a declared log-only event reaches no message and is not a failure', () => {
    const events = [headerEvent(), event(2, 'test/log-only', { text: 'kept in the log' })]

    expect(deriveMessages(events)).toEqual([])
  })

  test('a registered projection turns its event into history', () => {
    const events = [headerEvent(), event(2, 'test/projected', { text: 'from the plugin' })]

    expect(deriveMessages(events)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'from the plugin' }] },
    ])
  })

  test('the same event type cannot be projected twice', () => {
    expect(() =>
      registerMessageProjection({
        type: 'test/projected',
        name: 'again',
        project: (_e, derived) => derived,
      }),
    ).toThrow(/already registered/)
  })

  test('the compaction prune is the projection the session actually uses', () => {
    const events = [
      headerEvent(),
      event(2, 'user/message', { text: 'the long one', source: 'user' }),
      event(3, 'compaction/prune', {
        shadowedSeqs: [2],
        shadowedRange: { start: 2, end: 2 },
        shadowedBytes: 100,
        replacements: [{ seq: 2, content: [{ type: 'text', text: 'stub' }] }],
      }),
    ]

    expect(deriveMessages(events)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'stub' }] },
    ])
  })
})
