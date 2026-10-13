import { HooksLive } from '@fudo/kernel'
import { Tools, toolsLayer } from '@fudo/tools'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, test } from 'bun:test'
import { jobTools, makeJobs } from '../src/index.ts'

describe('job tools', () => {
  test('start, read, and stop a background command', async () => {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const jobs = yield* makeJobs()
          const context = yield* Layer.build(Layer.provideMerge(toolsLayer, HooksLive))
          const tools = Context.get(context, Tools)
          for (const tool of jobTools(jobs)) yield* tools.register(tool)

          const call = (name: string, args: unknown) =>
            tools.call({
              callId: 'c-' + name,
              tool: name,
              arguments: JSON.stringify(args),
              context: { sessionId: 's1', cwd: '/tmp', callId: 'c-' + name },
            })

          const started = yield* call('job_start', { command: 'echo from a job' })
          yield* Effect.sleep('200 millis')
          const read = yield* call('job_output', { id: 'job-1' })
          const killed = yield* call('job_kill', { id: 'job-1' })
          return { started: started?.value, read: read?.value, killed }
        }),
      ),
    )

    expect(observed.started).toEqual({ id: 'job-1', command: 'echo from a job' })
    expect(JSON.stringify(observed.read)).toContain('from a job')
    expect(observed.killed?.isError).toBe(false)
  })
})
