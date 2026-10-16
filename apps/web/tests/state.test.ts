import { describe, expect, test } from 'bun:test'
import type { UiEvent } from '@jozo-harness/ui-protocol'
import { applyUiEvent, initialState } from '../client/state.ts'

let seq = 0
const session = (type: string, data: unknown): UiEvent => {
  seq += 1
  return { kind: 'session', event: { seq, time: seq, type, data } }
}

const fold = (events: ReadonlyArray<UiEvent>) => events.reduce(applyUiEvent, initialState)

describe('the browser state', () => {
  test('the header learns where the session runs and what answers it', () => {
    const state = fold([
      session('session/header', { formatVersion: 1, createdAt: 0, cwd: '/work/a' }),
      session('request/header', {
        provider: 'ollama-cloud',
        model: 'deepseek-v4.1-flash',
        params: {},
        tools: [],
        series: 1,
        reason: 'opened',
      }),
      session('turn/start', { turn: 1 }),
      session('turn/start', { turn: 2 }),
    ])
    expect(state.info).toEqual({
      cwd: '/work/a',
      model: 'ollama-cloud/deepseek-v4.1-flash',
      turns: 2,
    })
  })

  test('a moved working directory follows in the header', () => {
    const state = fold([
      session('session/header', { formatVersion: 1, createdAt: 0, cwd: '/work/a' }),
      session('session/cwd/changed', { cwd: '/work/b' }),
    ])
    expect(state.info.cwd).toBe('/work/b')
  })

  test('an event body that is not the shape it claims leaves the header alone', () => {
    const state = fold([
      session('request/header', 'not a header'),
      session('turn/start', { turn: 'not a number' }),
    ])
    expect(state.info).toEqual({ cwd: '', model: '', turns: 0 })
  })
})
