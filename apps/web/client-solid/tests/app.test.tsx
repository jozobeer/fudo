import { fireEvent, render } from '@solidjs/testing-library'
import { describe, expect, test } from 'vitest'
import { createSignal } from 'solid-js'
import type { UiCommand } from '@jozo-harness/ui-protocol'
import { emptyConversation } from '@jozo-harness/ui-view'
import { initialState, withDraft, withTheme, type Pane, type WebState } from '../../client/state.ts'
import { Composer } from '../components/composer.tsx'
import { ContextPane } from '../components/context-pane.tsx'
import { Conversation } from '../components/conversation.tsx'
import { Rail } from '../components/rail.tsx'
import { Waterfall } from '../components/waterfall.tsx'
import type { SessionStore } from '../store.ts'
import { traceOf } from '../../client/trace.ts'

/** One call a component made, in the order it made them. */
type Call =
  | { readonly kind: 'submit' }
  | { readonly kind: 'draft'; readonly text: string }
  | { readonly kind: 'moveTo'; readonly id: string | undefined }
  | { readonly kind: 'pane'; readonly pane: Pane | undefined }
  | { readonly kind: 'command'; readonly command: UiCommand }

/** A store the components can be rendered against: signals in, calls out. */
const makeStore = (overrides: Partial<WebState> = {}) => {
  const [state, setState] = createSignal<WebState>({ ...initialState, ...overrides })
  const calls: Array<Call> = []
  const update = (next: (current: WebState) => WebState): void => {
    setState((current) => next(current))
  }
  const store: SessionStore = {
    state,
    start: () => undefined,
    stop: () => undefined,
    setDraft: (text) => {
      calls.push({ kind: 'draft', text })
      update((current) => withDraft(current, text))
    },
    submit: () => calls.push({ kind: 'submit' }),
    send: (command) => calls.push({ kind: 'command', command }),
    moveTo: (id) => calls.push({ kind: 'moveTo', id }),
    chooseTheme: (theme) => update((current) => withTheme(current, theme)),
    showPane: (pane) => calls.push({ kind: 'pane', pane }),
    openJob: () => undefined,
    stopJob: () => undefined,
    askModels: () => undefined,
    setModel: () => undefined,
  }
  return { store, calls, setState: update }
}

describe('the Solid page', () => {
  test('the rail lists the sessions and marks the one on screen', () => {
    const { store, calls } = makeStore({
      sessions: [
        { id: 'aaaabbbb', cwd: '/one/work', createdAt: Date.now() - 60_000, title: 'first' },
        { id: 'ccccdddd', cwd: '/two', createdAt: Date.now() - 7_200_000, title: '' },
      ],
      sessionId: 'aaaabbbb',
    })

    const { container } = render(() => <Rail store={store} />)

    const rows = container.querySelectorAll('button.session')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.classList.contains('active')).toBe(true)
    expect(rows[0]?.textContent).toContain('first')
    expect(rows[1]?.textContent).toContain('ccccdddd')

    fireEvent.click(rows[1] as Element)
    expect(calls).toContainEqual({ kind: 'moveTo', id: 'ccccdddd' })
  })

  test('the conversation renders markdown, tool output, and the live step', () => {
    const { store } = makeStore({
      conversation: {
        ...emptyConversation,
        blocks: [
          { kind: 'user', text: 'hello' },
          { kind: 'assistant', text: '# Heading' },
          {
            kind: 'tool',
            callId: 'c1',
            name: 'read',
            summary: 'a.ts',
            status: 'done',
            result: 'a.ts',
            output: 'the file said so',
          },
        ],
        live: 'still writing',
      },
    })

    const { container } = render(() => <Conversation store={store} />)

    expect(container.querySelector('.block.user .body')?.textContent).toBe('hello')
    expect(container.querySelector('.markdown h1')?.textContent).toBe('Heading')
    expect(container.querySelector('.tool-card .tool-output')?.textContent).toBe('the file said so')
    expect(container.querySelector('.block.live')?.textContent).toContain('still writing')
  })

  test('an approval answers through the store, from the buttons and from y / n', () => {
    const { store, calls } = makeStore({
      conversation: {
        ...emptyConversation,
        approval: { callId: 'c1', tool: 'bash', reason: 'runs a command' },
      },
    })

    const { container } = render(() => <Composer store={store} />)

    const allow = container.querySelector('#takeover [data-approve="true"]')
    expect(allow?.textContent).toBe('Allow')
    fireEvent.click(allow as Element)
    expect(calls).toContainEqual({
      kind: 'command',
      command: { kind: 'approve', callId: 'c1', approved: true },
    })

    fireEvent.keyDown(document, { key: 'n' })
    expect(calls).toContainEqual({
      kind: 'command',
      command: { kind: 'approve', callId: 'c1', approved: false },
    })
  })

  test('the composer keeps the draft and asks the store to submit it', () => {
    const { store, calls } = makeStore()

    const { container } = render(() => <Composer store={store} />)

    const input = container.querySelector('#input') as HTMLTextAreaElement
    fireEvent.input(input, { target: { value: 'ping' } })
    expect(calls).toContainEqual({ kind: 'draft', text: 'ping' })

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(calls).toContainEqual({ kind: 'submit' })

    const stop = container.querySelector('#cancel')
    fireEvent.click(stop as Element)
    expect(calls).toContainEqual({ kind: 'command', command: { kind: 'cancel' } })
  })

  test('the pane reads the run state and hands a tab click to the store', () => {
    const { store, calls } = makeStore({
      pane: { kind: 'run' },
      run: {
        goal: { objective: 'ship the port', phase: 'active', rounds: 1, maxRounds: 8 },
        schedules: [],
        jobs: [],
        queued: [],
      },
    })

    const { container } = render(() => <ContextPane store={store} />)

    expect(container.querySelector('.run-objective')?.textContent).toBe('ship the port')
    expect(container.querySelector('.run-phase')?.textContent).toBe('active')

    const turns = [...container.querySelectorAll('button.tab')].find(
      (tab) => tab.textContent === 'turns',
    )
    fireEvent.click(turns as Element)
    expect(calls).toContainEqual({ kind: 'pane', pane: { kind: 'trajectory' } })
  })

  test('the trace draws each call on its turn, and a call opens in the inspector', () => {
    const at = (seq: number, type: string, data: unknown) => ({ seq, time: seq * 1000, type, data })
    const { store, calls } = makeStore({
      trace: traceOf([
        at(1, 'turn/start', { turn: 1 }),
        at(2, 'step/start', { step: 1 }),
        at(3, 'tool/call', { callId: 'c1', name: 'bash', arguments: '{}', summary: 'pnpm test' }),
        at(5, 'tool/result', { callId: 'c1', isError: true, summary: 'exit 1', content: [] }),
        at(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      ]),
    })

    const { container } = render(() => <Waterfall store={store} />)

    expect(container.querySelector('.wf-turn-failed')?.textContent).toBe('1 failed')
    const row = container.querySelector('button.wf-row.tool.error')
    expect(row?.querySelector('.wf-took')?.textContent).toBe('2.0s')
    fireEvent.click(row as Element)
    expect(calls).toContainEqual({ kind: 'pane', pane: { kind: 'inspect', turn: 1, callId: 'c1' } })
  })
})
