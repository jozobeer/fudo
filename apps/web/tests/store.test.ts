import { describe, expect, test } from 'vitest'
import type { UiCommand, UiEvent, UiHost, UiSessionEvent } from '@jozo-harness/ui-protocol'
import { Cause, Deferred, Effect, Queue, Stream, type Scope } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  serveWeb,
  WebError,
  type OpenSession,
  type SessionFactory,
  type SettingsPort,
} from '../src/server/index.ts'
import type { JobDetailView, RunStateView, SessionSummary } from '../src/shared/rpc.ts'
import { createSessionStore, type SessionStore } from '../client-solid/store.ts'

/**
 * The page's store against the real server, over a real socket. The store is the
 * browser's half of the pair, and the ways the core can disappoint it — a feed
 * that drops with no word, a message the core will not take — are the ones that
 * read to a reader as input that does nothing.
 */

/** What the page's browser calls did, for a run outside a browser. */
interface StubbedBrowser {
  readonly kept: () => string | undefined
  readonly attribute: () => string | undefined
}

/** The little of the browser the store touches, for a run outside one. */
const stubTheBrowser = (): StubbedBrowser => {
  const globals = globalThis as unknown as Record<string, unknown>
  let kept: string | undefined
  const dataset: Record<string, string | undefined> = {}
  globals.localStorage = {
    getItem: () => kept ?? null,
    setItem: (_key: string, value: string) => {
      kept = value
    },
  }
  globals.document = { documentElement: { dataset } }
  globals.history = { replaceState: () => undefined }
  globals.window = { location: { protocol: 'http:', host: '127.0.0.1:8080', search: '?session=a' } }
  return { kept: () => kept, attribute: () => dataset.theme }
}

interface FakeHost {
  readonly summary: SessionSummary
  readonly host: UiHost
  readonly runState: () => RunStateView
  readonly jobOutput: (id: string) => Effect.Effect<JobDetailView, WebError>
  readonly stopJob: (id: string) => Effect.Effect<void, WebError>
  readonly commands: ReadonlyArray<UiCommand>
  /** Appends to the log and feeds whoever follows it now. */
  readonly said: (event: UiEvent) => void
  /** Drops every feed of this session, as a defect on the wire does. */
  readonly dropped: () => void
  /** How many times a client asked to follow this session. */
  readonly followed: () => number
  /** How many times a client read the run state: once when it opens, once per read again. */
  readonly states: () => number
  /** False makes `submit` die, as a core that fell over does. */
  accepting: boolean
}

const event = (seq: number, type: string, data: unknown): UiEvent => ({
  kind: 'session',
  event: { seq, time: seq, type, data } as UiSessionEvent,
})

const turn = (seq: number, text: string): UiEvent =>
  event(seq, 'user/message', { text, source: 'user' })

const makeHost = (id: string): FakeHost => {
  const log: Array<UiEvent> = []
  const subscribers = new Set<Queue.Queue<UiEvent>>()
  const commands: Array<UiCommand> = []
  let follows = 0
  let states = 0
  const host: FakeHost = {
    summary: { id, cwd: '/work', createdAt: 1, title: '' },
    runState: () => {
      states += 1
      return { goal: null, schedules: [], jobs: [], queued: [] }
    },
    jobOutput: () => Effect.fail(new WebError({ message: 'no such job' })),
    stopJob: () => Effect.void,
    commands,
    accepting: true,
    said: (one) => {
      log.push(one)
      for (const queue of subscribers.values().toArray()) Queue.offerUnsafe(queue, one)
    },
    dropped: () => {
      for (const queue of subscribers.values().toArray()) {
        Queue.failCauseUnsafe(queue, Cause.die('the feed dropped'))
      }
      subscribers.clear()
    },
    followed: () => follows,
    states: () => states,
    host: {
      // Every follower is handed the log first, then what happens next: the same
      // shape the real host has, and what lets a second look recover a gap.
      events: Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            follows += 1
            const queue = yield* Queue.unbounded<UiEvent>()
            for (const one of log) yield* Queue.offer(queue, one)
            subscribers.add(queue)
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                subscribers.delete(queue)
              }),
            )
            return Stream.fromQueue(queue)
          }),
        ),
      ),
      submit: (text) =>
        Effect.suspend(() => {
          commands.push({ kind: 'submit', text })
          return host.accepting ? Effect.void : Effect.die(new Error('the core fell over'))
        }),
      approve: (callId, approved) =>
        Effect.sync(() => {
          commands.push({ kind: 'approve', callId, approved })
        }),
      answer: (askId, answer) =>
        Effect.sync(() => {
          commands.push({ kind: 'answer', id: askId, answer })
        }),
      cancel: () =>
        Effect.sync(() => {
          commands.push({ kind: 'cancel' })
        }),
      answerApproval: () => Effect.succeed(true),
      answerAsk: () => Effect.succeed(''),
    },
  }
  return host
}

const openOf = (host: FakeHost): OpenSession => ({
  summary: host.summary,
  host: host.host,
  runState: host.runState,
  jobOutput: host.jobOutput,
  stopJob: host.stopJob,
})

const settings: SettingsPort = {
  read: () =>
    Effect.succeed({
      model: 'stub/model',
      effort: '',
      settingsPath: '/work/settings.yml',
      cwd: '/work',
      sessionRoot: '/work/sessions',
    }),
  models: () => Effect.succeed(['stub/model']),
  setModel: () => Effect.void,
}

/** Serves one fake host until the test's scope closes. */
const serve = (
  host: FakeHost,
): Effect.Effect<
  { readonly wsUrl: string; readonly stop: Deferred.Deferred<void>; readonly root: string },
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<string>()
    const stop = yield* Deferred.make<void>()
    const factory: SessionFactory = {
      list: () => Effect.succeed([host.summary]),
      open: () => Effect.succeed(openOf(host)),
    }
    const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'jzh-store-test-')))
    yield* Effect.forkScoped(
      serveWeb({
        initial: openOf(host),
        factory,
        settings,
        port: 0,
        staticRoot: root,
        onReady: (url) => {
          void Effect.runSync(Deferred.succeed(ready, url))
        },
        interrupt: Deferred.await(stop),
      }),
    )
    const origin = (yield* Deferred.await(ready)).replace(/\/$/, '')
    return { wsUrl: 'ws://' + origin.replace(/^http:\/\//, '') + '/ui', stop, root }
  })

/** Waits for what the page reaches on its own, or fails saying what never came. */
const until = (wanted: () => boolean, what: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (wanted()) return
      yield* Effect.sleep('25 millis')
    }
    return yield* Effect.die(new Error('the page never ' + what))
  })

const saidTexts = (store: SessionStore): ReadonlyArray<string> =>
  store.state().conversation.blocks.flatMap((block) => (block.kind === 'user' ? [block.text] : []))

/** Serves one host, starts the page's store on it, and hands both to the body. */
const withStore = (
  host: FakeHost,
  body: (store: SessionStore) => Effect.Effect<void>,
): Effect.Effect<void> =>
  Effect.scoped(
    Effect.gen(function* () {
      const { wsUrl, stop, root } = yield* serve(host)
      const store = createSessionStore({ url: wsUrl, search: '' })
      store.start()
      yield* until(() => store.state().sessionId === 'a', 'opened the session')
      yield* body(store)
      store.stop()
      yield* Deferred.succeed(stop, undefined)
      yield* Effect.promise(() => rm(root, { recursive: true, force: true }))
    }),
  )

describe('the page store', () => {
  test('a long log keeps unfolding while the page reads the store again', async () => {
    stubTheBrowser()
    const host = makeHost('a')
    // The first look replays the whole log in one burst, and the second event in
    // it asks the page to read the store again. A feed that makes that call
    // itself stops draining: the client stops reading the socket while a feed's
    // buffer holds events, so the answer sits behind the very events the call is
    // holding up, and the page stays empty with nothing said about why.
    host.said(event(1, 'turn/start', { turn: 1 }))
    host.said(event(2, 'agent/inbox/queued', { message: { source: 'user', text: 'the ask' } }))
    for (let index = 0; index < 40; index += 1) {
      host.said(turn(3 + index, 'line ' + String(index + 1)))
    }
    await Effect.runPromise(
      withStore(host, (store) =>
        Effect.gen(function* () {
          yield* until(() => saidTexts(store).includes('line 40'), 'showed the whole log')
          // The read again happened too, on the page's own fiber.
          yield* until(() => host.states() >= 2, 'read the run state again')
        }),
      ),
    )
  }, 15_000)

  test('following again brings the turns a dropped feed missed', async () => {
    stubTheBrowser()
    const host = makeHost('a')
    await Effect.runPromise(
      withStore(host, (store) =>
        Effect.gen(function* () {
          yield* until(() => host.followed() >= 1, 'followed the session')
          host.said(turn(1, 'one'))
          yield* until(() => saidTexts(store).includes('one'), 'showed the first turn')

          // The feed dies with no word to the page, and nothing the reader did.
          host.dropped()
          yield* until(() => host.followed() >= 3, 'followed the session again')

          // A turn logged while nothing was listening: the second look replays
          // the log, so the page catches up without the reader asking again.
          host.said(turn(2, 'two'))
          yield* until(() => saidTexts(store).includes('two'), 'showed the turn it missed')
        }),
      ),
    )
  })

  test('a message the core never took is said out loud, and the draft comes back', async () => {
    stubTheBrowser()
    const host = makeHost('a')
    await Effect.runPromise(
      withStore(host, (store) =>
        Effect.gen(function* () {
          // The call dies, which takes every pending call of the page with it.
          host.accepting = false
          store.setDraft('a message nobody takes')
          store.submit()
          // The call dies, which takes every pending call of the page with it: the
          // line comes back to the composer, so nothing the reader typed is lost.
          yield* until(
            () => store.state().draft === 'a message nobody takes',
            'gave the message back',
          )

          // The pipeline outlives it: the next message still reaches the core.
          host.accepting = true
          store.submit()
          yield* until(
            () => host.commands.filter((one) => one.kind === 'submit').length >= 2,
            'sent the next message',
          )

          // A session the server does not hold is refused without a word of its
          // own: the page says so, looks at the session again rather than taking
          // the next line into the same void, and keeps saying why.
          const followed = host.followed()
          store.sendTo('nobody-holds-this', { kind: 'submit', text: 'into the void' })
          yield* until(() => host.followed() > followed, 'looked at the session again')
          yield* until(() => store.state().problem !== '', 'said the session was refused')
        }),
      ),
    )
  })

  test('the browser the page runs in is named in one place', () => {
    const browser = stubTheBrowser()
    // No url and no search: both come from the page the store is running in.
    const store = createSessionStore()
    store.chooseTheme('dark')
    expect(store.state().theme).toBe('dark')
    expect(browser.kept()).toBe('dark')
    expect(browser.attribute()).toBe('dark')
  })
})
