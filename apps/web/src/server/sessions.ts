import type { UiHost } from '@jozo-harness/ui-protocol'
import { Data, Effect, Exit, Scope } from 'effect'
import type { SessionSummary } from '../shared/rpc.ts'

/** One session the server can serve: the summary a page lists, and the UI face of its core. */
export interface OpenSession {
  readonly summary: SessionSummary
  readonly host: UiHost
}

/** Why a session could not be opened. The page shows the message. */
export class WebSessionError extends Data.TaggedError('WebSessionError')<{
  readonly message: string
}> {}

/** What the app that owns the profiles gives the server: the store's list, and one more session. */
export interface SessionFactory {
  readonly list: () => Effect.Effect<ReadonlyArray<SessionSummary>, WebSessionError>
  /** Opens the named session, or creates one when the id is absent. */
  readonly open: (
    id: string | undefined,
  ) => Effect.Effect<OpenSession, WebSessionError, Scope.Scope>
}

/** The sessions one server serves: the one it started with, plus any the page asks for later. */
export interface SessionRegistry {
  /** The session a page opens when it names none. */
  readonly initial: string
  readonly list: () => Effect.Effect<ReadonlyArray<SessionSummary>, WebSessionError>
  readonly open: (id: string | undefined) => Effect.Effect<OpenSession, WebSessionError>
  /** The host of a session already open; undefined when the page names one nobody opened. */
  readonly hostOf: (id: string) => UiHost | undefined
}

/**
 * Keeps one running core per session. A session opens the first time a page asks
 * for it and stays open until the server stops, so switching back is free.
 */
export const makeSessionRegistry = (input: {
  readonly initial: OpenSession
  readonly factory: SessionFactory
}): Effect.Effect<SessionRegistry, never, Scope.Scope> =>
  Effect.gen(function* () {
    const opened = new Map<string, OpenSession>([[input.initial.summary.id, input.initial]])
    // The scope this registry lives in: every session it opens is closed with it.
    const own = yield* Scope.Scope

    const openInOwnScope = (id: string | undefined): Effect.Effect<OpenSession, WebSessionError> =>
      Effect.gen(function* () {
        const known = id === undefined ? undefined : opened.get(id)
        if (known !== undefined) return known
        // One scope per session: the server's own scope closes it when the server stops.
        const scope = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
        const session = yield* input.factory
          .open(id)
          .pipe(Effect.provideService(Scope.Scope, scope))
        opened.set(session.summary.id, session)
        return session
      }).pipe(Effect.provideService(Scope.Scope, own))

    return {
      initial: input.initial.summary.id,
      list: input.factory.list,
      open: openInOwnScope,
      hostOf: (id) => opened.get(id)?.host,
    }
  })
