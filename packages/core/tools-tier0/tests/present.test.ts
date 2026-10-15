import { describe, expect, test } from 'bun:test'
import { callSummary, resultSummary, oneLine } from '@jozo-harness/tools'
import { changedLines, exitSummaryOf, rangeOf } from '../src/index.ts'

describe('the one line a tool shows', () => {
  test('a read says which file and which lines', () => {
    expect(rangeOf({ path: 'src/app.ts' })).toBe('src/app.ts')
    expect(rangeOf({ path: 'src/app.ts', offset: 10 })).toBe('src/app.ts:10+')
    expect(rangeOf({ path: 'src/app.ts', offset: 10, limit: 31 })).toBe('src/app.ts:10-40')
    expect(rangeOf({ path: 'src/app.ts', limit: 5 })).toBe('src/app.ts:1-5')
  })

  test('an edit says how many lines it adds and drops', () => {
    expect(changedLines({ oldString: 'one\ntwo', newString: 'one\ntwo\nthree' })).toBe(
      'lines: 2 → 3',
    )
    expect(changedLines({ oldString: 'one', newString: '' })).toBe('lines: 1 → 0')
    expect(changedLines({ oldString: 'a', newString: 'b', all: true })).toBe('lines: 1 → 1 (all)')
  })

  test('a bash result says the exit code, not the first line of output', () => {
    expect(exitSummaryOf('hello\n[exit code: 0]')).toBe('exit 0')
    expect(exitSummaryOf('[stderr]\nboom\n[exit code: 3]')).toBe('exit 3')
    expect(exitSummaryOf('\n[timed out after 5000ms]\n[exit code: 137]')).toBe(
      'exit 137 after 5000ms',
    )
    // Nothing ran: the text itself is the only thing there is to show.
    expect(exitSummaryOf('no sandbox')).toBe('no sandbox')
  })

  test('the fallbacks keep a line short and free of newlines', () => {
    expect(oneLine('  a\n  b  ')).toBe('a b')
    expect(callSummary('bash', '{"command":"ls -la"}')).toBe('{"command":"ls -la"}')
    expect(callSummary('bash', '{}')).toBe('{}')
    const long = 'x'.repeat(500)
    expect(callSummary('bash', long)).toHaveLength(80)
    expect(resultSummary([{ type: 'text', text: long }])).toHaveLength(200)
    expect(resultSummary([{ type: 'image', mediaType: 'image/png', data: 'a' }])).toBe('')
  })
})
