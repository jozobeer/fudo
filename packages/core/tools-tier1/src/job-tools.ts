import { Schema, Effect } from 'effect'
import type { ToolDefinition } from '@fudo/tools'
import type { JobsShape } from './jobs.ts'

const StartParameters = Schema.Struct({
  command: Schema.String,
  cwd: Schema.optionalKey(Schema.String),
})
const IdParameters = Schema.Struct({ id: Schema.String })

/** Starts a command in the background, so long work can overlap with the turn. */
export const makeJobStartTool = (
  jobs: JobsShape,
): ToolDefinition<{ command: string; cwd?: string }, { id: string; command: string }> => ({
  name: 'job_start',
  description: 'Starts a command in the background and returns its job id.',
  parameters: StartParameters,
  needs: ['exec'],
  output: {
    schema: Schema.Struct({ id: Schema.String, command: Schema.String }),
    render: (_args, value) => [
      { type: 'text', text: 'started ' + value.id + ': ' + value.command },
    ],
  },
  execute: (args, context) =>
    jobs
      .start(args.command, args.cwd ?? context.cwd)
      .pipe(Effect.map((job) => ({ id: job.id, command: job.command }))),
})

/** Reads what a background job has produced so far. */
export const makeJobOutputTool = (
  jobs: JobsShape,
): ToolDefinition<{ id: string }, { id: string; running: boolean; output: string }> => ({
  name: 'job_output',
  description: 'Reads the output a background job has produced so far.',
  parameters: IdParameters,
  needs: ['read'],
  output: {
    schema: Schema.Struct({ id: Schema.String, running: Schema.Boolean, output: Schema.String }),
    render: (_args, value) => [
      { type: 'text', text: value.output + (value.running ? '\n[running]' : '\n[finished]') },
    ],
  },
  execute: (args) =>
    jobs
      .read(args.id)
      .pipe(Effect.map((job) => ({ id: job.id, running: job.running, output: job.output }))),
})

/** Stops a background job. */
export const makeJobKillTool = (
  jobs: JobsShape,
): ToolDefinition<{ id: string }, { id: string }> => ({
  name: 'job_kill',
  description: 'Stops a background job.',
  parameters: IdParameters,
  needs: ['exec'],
  output: {
    schema: Schema.Struct({ id: Schema.String }),
    render: (_args, value) => [{ type: 'text', text: 'stopped ' + value.id }],
  },
  execute: (args) => jobs.kill(args.id).pipe(Effect.map(() => ({ id: args.id }))),
})

/** The background job tools over one registry the caller owns. */
export const jobTools = (jobs: JobsShape): ReadonlyArray<ToolDefinition<any, any>> => [
  makeJobStartTool(jobs),
  makeJobOutputTool(jobs),
  makeJobKillTool(jobs),
]
