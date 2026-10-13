import { Effect } from 'effect'
import { ToolError } from '@fudo/tools'

export interface Job {
  readonly id: string
  readonly command: string
  running: boolean
  output: string
}

export interface JobsShape {
  /** Starts a command in the background and returns its handle. */
  readonly start: (command: string, cwd: string) => Effect.Effect<Job, ToolError>
  readonly read: (id: string) => Effect.Effect<Job, ToolError>
  readonly kill: (id: string) => Effect.Effect<void, ToolError>
  readonly list: () => ReadonlyArray<Job>
}

/** How much output one job keeps in memory. */
export const JOB_OUTPUT_LIMIT = 64_000

/**
 * Background commands. Output is kept in memory up to a limit and the process
 * is killed explicitly; jobs do not survive the command that started them.
 */
export const makeJobs = (): Effect.Effect<JobsShape> =>
  Effect.sync(() => {
    const jobs = new Map<string, { job: Job; process: Bun.Subprocess }>()
    let counter = 0

    const collect = (job: Job, stream: ReadableStream<Uint8Array>): void => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      void (async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value === undefined) continue
          job.output = (job.output + decoder.decode(value)).slice(-JOB_OUTPUT_LIMIT)
        }
      })()
    }

    return {
      start: (command, cwd) =>
        Effect.sync(() => {
          counter += 1
          const id = 'job-' + String(counter)
          const process = Bun.spawn({
            cmd: ['bash', '-lc', command],
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
          })
          const job: Job = { id, command, running: true, output: '' }
          collect(job, process.stdout)
          collect(job, process.stderr)
          void process.exited.then(() => {
            job.running = false
          })
          jobs.set(id, { job, process })
          return job
        }),
      read: (id) =>
        Effect.gen(function* () {
          const entry = jobs.get(id)
          if (entry === undefined) {
            return yield* Effect.fail(
              new ToolError({ code: 'execution', message: 'unknown job: ' + id }),
            )
          }
          return entry.job
        }),
      kill: (id) =>
        Effect.gen(function* () {
          const entry = jobs.get(id)
          if (entry === undefined) {
            return yield* Effect.fail(
              new ToolError({ code: 'execution', message: 'unknown job: ' + id }),
            )
          }
          entry.process.kill()
          entry.job.running = false
        }),
      list: () => [...jobs.values()].map((entry) => entry.job),
    }
  })
