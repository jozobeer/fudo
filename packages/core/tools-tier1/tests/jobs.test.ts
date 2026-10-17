import { describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import { makeJobs } from '../src/index.ts'

describe('jobs', () => {
  test('starts a command, reads its output, and stops it', async () => {
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* makeJobs()
        const running = yield* jobs.start('echo hello && sleep 5', '/tmp')
        yield* Effect.sleep('200 millis')
        const read = yield* jobs.read(running.id)
        const listed = jobs.list().map((job) => job.id)
        yield* jobs.kill(running.id)
        yield* Effect.sleep('50 millis')
        const after = yield* jobs.read(running.id)
        return { output: read.output, listed, running: after.running }
      }),
    )

    expect(observed.output).toContain('hello')
    expect(observed.listed).toEqual(['job-1'])
    expect(observed.running).toBe(false)
  })

  test('an unknown job is an error', async () => {
    const failed = await Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* makeJobs()
        return yield* Effect.match(jobs.read('nope'), {
          onFailure: (error) => error.message,
          onSuccess: () => 'ok',
        })
      }),
    )

    expect(failed).toContain('unknown job')
  })
})
