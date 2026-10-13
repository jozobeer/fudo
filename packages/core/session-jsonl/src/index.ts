import {
  SESSION_FORMAT_VERSION,
  SessionError,
  decodeSessionEvent,
  type SessionEventSchemaMap,
  type OpenedSession,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
  type SessionPersistence,
  type SessionSink,
  type SessionSummary,
} from '@fudo/session'
import { Effect } from 'effect'
import type { Dirent } from 'node:fs'
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface JsonlSessionsOptions {
  /** Directory that holds one subdirectory per session. */
  readonly root: string
  /** Event schemas beyond the core catalog, keyed by event type. */
  readonly schemas?: SessionEventSchemaMap
}

const FILE_NAME = 'session.v1.jsonl'

const persistenceError = (message: string, cause?: unknown): SessionError =>
  new SessionError({
    code: 'persistence',
    message: cause === undefined ? message : `${message}: ${String(cause)}`,
  })

const notFound = (id: string): SessionError =>
  new SessionError({ code: 'not-found', message: `no session ${id}` })

const isMissing = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ENOENT'

const parseLine = (
  id: SessionId,
  lineNumber: number,
  line: string,
): Effect.Effect<unknown, SessionError> =>
  Effect.try({
    try: () => JSON.parse(line) as unknown,
    catch: (cause) => persistenceError(`line ${lineNumber} of session ${id} is not JSON`, cause),
  })

const decodeEvents = (
  id: SessionId,
  text: string,
  schemas: SessionEventSchemaMap | undefined,
): Effect.Effect<ReadonlyArray<SessionEvent>, SessionError> =>
  Effect.gen(function* () {
    const events: Array<SessionEvent> = []
    for (const [index, line] of text.split('\n').entries()) {
      if (line.trim() === '') continue
      const event = yield* decodeSessionEvent(yield* parseLine(id, index + 1, line), schemas)
      if (event !== undefined) events.push(event)
    }
    const first = events[0]
    if (first === undefined || first.type !== 'session/header') {
      return yield* Effect.fail(
        persistenceError(`session ${id} does not start with session/header`),
      )
    }
    if (first.data.formatVersion !== SESSION_FORMAT_VERSION) {
      return yield* Effect.fail(
        persistenceError(`session ${id} has unsupported formatVersion ${first.data.formatVersion}`),
      )
    }
    return events
  })

const readHeader = (
  id: SessionId,
  text: string,
  schemas: SessionEventSchemaMap | undefined,
): Effect.Effect<SessionHeader, SessionError> =>
  Effect.gen(function* () {
    const firstLine = text.split('\n').find((line) => line.trim() !== '')
    if (firstLine === undefined)
      return yield* Effect.fail(persistenceError(`session ${id} is empty`))
    const event = yield* decodeSessionEvent(yield* parseLine(id, 1, firstLine), schemas)
    if (event === undefined || event.type !== 'session/header') {
      return yield* Effect.fail(
        persistenceError(`session ${id} does not start with session/header`),
      )
    }
    return event.data
  })

const sinkFor = (path: string, id: SessionId): SessionSink => ({
  append: (event) =>
    Effect.tryPromise({
      try: () => appendFile(path, JSON.stringify(event) + '\n'),
      catch: (cause) => persistenceError(`cannot append to session ${id}`, cause),
    }),
  flush: () => Effect.void,
})

/** Stores each session as one JSONL file under `root/<id>/session.v1.jsonl`. */
export function jsonlSessions(options: JsonlSessionsOptions): SessionPersistence {
  const directoryOf = (id: SessionId): string => join(options.root, id)
  const fileOf = (id: SessionId): string => join(directoryOf(id), FILE_NAME)

  const readText = (id: SessionId): Effect.Effect<string, SessionError> =>
    Effect.tryPromise({
      try: () => readFile(fileOf(id), 'utf8'),
      catch: (cause) =>
        isMissing(cause) ? notFound(id) : persistenceError(`cannot read session ${id}`, cause),
    })

  const create = (header: SessionHeader): Effect.Effect<OpenedSession, SessionError> =>
    Effect.gen(function* () {
      const id = crypto.randomUUID()
      yield* Effect.tryPromise({
        try: () => mkdir(directoryOf(id), { recursive: true }),
        catch: (cause) => persistenceError(`cannot create session ${id}`, cause),
      })
      const first: SessionEvent = {
        seq: 1,
        time: header.createdAt,
        type: 'session/header',
        data: header,
      }
      const sink = sinkFor(fileOf(id), id)
      yield* sink.append(first)
      return { id, events: [first], sink }
    })

  const open = (id: SessionId): Effect.Effect<OpenedSession, SessionError> =>
    Effect.gen(function* () {
      const events = yield* decodeEvents(id, yield* readText(id), options.schemas)
      return { id, events, sink: sinkFor(fileOf(id), id) }
    })

  const stat = (id: SessionId): Effect.Effect<SessionSummary, SessionError> =>
    Effect.gen(function* () {
      const header = yield* readHeader(id, yield* readText(id), options.schemas)
      return { id, cwd: header.cwd, createdAt: header.createdAt }
    })

  const list = (): Effect.Effect<ReadonlyArray<SessionSummary>, SessionError> =>
    Effect.gen(function* () {
      const entries = yield* Effect.tryPromise({
        try: () => readdir(options.root, { withFileTypes: true }),
        catch: (cause) =>
          isMissing(cause)
            ? notFound(options.root)
            : persistenceError('cannot list sessions', cause),
      }).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            error.code === 'not-found'
              ? Effect.succeed<ReadonlyArray<Dirent>>([])
              : Effect.fail(error),
          onSuccess: (found) => Effect.succeed(found),
        }),
      )
      const summaries: Array<SessionSummary> = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const summary = yield* stat(entry.name).pipe(
          Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
        )
        if (summary !== undefined) summaries.push(summary)
      }
      return summaries
    })

  return { create, open, stat, list }
}
