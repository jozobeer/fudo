import { SESSION_FORMAT_VERSION, SessionError } from '@jozo-harness/session'
import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { jsonlSessions, splitTornTail, upgradeHeader } from '../src/index.ts'

const header = (data: unknown): string =>
  JSON.stringify({ seq: 1, time: 1, type: 'session/header', data })

const line = (seq: number, type: string, data: unknown, time = seq): string =>
  JSON.stringify({ seq, time, type, data })

/** A session file written by hand, as an older build or a crash would leave it. */
const withLog = async (
  text: string,
  run: (paths: {
    readonly root: string
    readonly id: string
    readonly file: string
  }) => Promise<void>,
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), 'jozo-harness-durable-'))
  const id = 's-old'
  const directory = join(root, id)
  const file = join(directory, 'session.v1.jsonl')
  await mkdir(directory, { recursive: true })
  await writeFile(file, text)
  try {
    await run({ root, id, file })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const eventsOf = (root: string, id: string) =>
  Effect.runPromise(jsonlSessions({ root }).open(id)).then((opened) => opened.events)

describe('a log of an older generation', () => {
  test('opens and is carried forward to this build', async () => {
    const old =
      header({ createdAt: 5, cwd: '/work' }) + '\n' + line(2, 'turn/start', { turn: 1 }) + '\n'

    await withLog(old, async ({ root, id }) => {
      const events = await eventsOf(root, id)

      expect(events).toHaveLength(2)
      expect(events[0]?.type).toBe('session/header')
      expect(events[1]?.type).toBe('turn/start')
    })
  })

  test('a header that does not say where it was written says so', async () => {
    // v0: no formatVersion, no cwd — the log cannot answer either question.
    const old = header({ createdAt: 5 }) + '\n'

    await withLog(old, async ({ root, id }) => {
      const events = await eventsOf(root, id)
      const first = events[0]

      expect(first?.type === 'session/header' && first.data.formatVersion).toBe(
        SESSION_FORMAT_VERSION,
      )
      expect(first?.type === 'session/header' && first.data.cwd).toBe('(not recorded)')
      // createdAt comes from the file on disk, not from nowhere.
      expect(first?.type === 'session/header' && first.data.createdAt).toBeGreaterThan(0)
    })
  })

  test('a log of a generation this build does not know is refused, saying so', async () => {
    const newer = header({ formatVersion: SESSION_FORMAT_VERSION + 1, createdAt: 5, cwd: '/work' })

    await withLog(newer + '\n', async ({ root, id }) => {
      const failed = await Effect.runPromise(Effect.result(jsonlSessions({ root }).open(id)))

      expect(failed._tag).toBe('Failure')
      expect(failed._tag === 'Failure' && (failed.failure as SessionError).message).toContain(
        'newer jozo-harness',
      )
    })
  })
})

describe('a log a crash cut short', () => {
  test('keeps everything written before the tear, and says it repaired the rest', async () => {
    const cut =
      header({ formatVersion: 1, createdAt: 1, cwd: '/work' }) +
      '\n' +
      line(2, 'turn/start', { turn: 1 }) +
      '\n' +
      '{"seq":3,"time":3,"ty'

    await withLog(cut, async ({ root, id, file }) => {
      const events = await eventsOf(root, id)
      const repaired = await readFile(file, 'utf8')

      // What was written complete is read; the half line is gone.
      expect(events.map((event) => event.type)).toEqual([
        'session/header',
        'turn/start',
        'session/repaired',
      ])
      expect(events[2]?.type === 'session/repaired' && events[2].data.tornBytes).toBe(
        cut.length - cut.indexOf('{"seq":3'),
      )
      expect(repaired).toContain('"type":"session/repaired"')
      expect(repaired.endsWith('\n')).toBe(true)
      // The file is whole again: a second read needs no repair.
      const again = await Effect.runPromise(jsonlSessions({ root }).open(id))
      expect(again.events.map((event) => event.type)).toEqual([
        'session/header',
        'turn/start',
        'session/repaired',
      ])
    })
  })

  test('a log cut off before its header was written cannot open', async () => {
    await withLog('{"seq":1,"time":1,"ty', async ({ root, id }) => {
      const failed = await Effect.runPromise(Effect.result(jsonlSessions({ root }).open(id)))

      expect(failed._tag).toBe('Failure')
      expect(failed._tag === 'Failure' && (failed.failure as SessionError).message).toContain(
        'before its header',
      )
    })
  })

  test('a listing shows an old session as it is, without touching the file', async () => {
    const old = header({ createdAt: 5, cwd: '/work' }) + '\n' + '{"seq":2,"time":2,"ty'

    await withLog(old, async ({ root, file }) => {
      const listed = await Effect.runPromise(jsonlSessions({ root }).list())
      const after = await readFile(file, 'utf8')

      expect(listed.map((summary) => summary.id)).toEqual(['s-old'])
      expect(after).toBe(old)
    })
  })
})

describe('splitting a log at its last complete line', () => {
  test('a complete log is kept whole, a cut one loses only the tail', () => {
    expect(splitTornTail('')).toEqual({ keep: '', tornBytes: 0 })
    expect(splitTornTail('one\n')).toEqual({ keep: 'one\n', tornBytes: 0 })
    expect(splitTornTail('one\ntwo')).toEqual({ keep: 'one\n', tornBytes: 3 })
    expect(splitTornTail('cut')).toEqual({ keep: '', tornBytes: 3 })
  })
})

describe('carrying a header forward', () => {
  test('fills what an old header cannot say from what the reader knows', () => {
    const upgraded = upgradeHeader({ createdAt: 7, cwd: '/work' }, { mtimeMs: 42 })

    expect(upgraded).toEqual({
      header: { formatVersion: SESSION_FORMAT_VERSION, createdAt: 7, cwd: '/work' },
      from: 0,
      changed: true,
    })
  })

  test('leaves a header of this generation alone', () => {
    const current = { formatVersion: SESSION_FORMAT_VERSION, createdAt: 7, cwd: '/work' }

    const upgraded = upgradeHeader(current, { mtimeMs: 42 })

    expect(upgraded).toEqual({ header: current, from: SESSION_FORMAT_VERSION, changed: false })
  })
})
