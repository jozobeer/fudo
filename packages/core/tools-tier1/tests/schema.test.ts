import { describe, expect, test } from 'bun:test'
import type { AgentsShape } from '@fudo/agent'
import { makeAsk } from '@fudo/safety'
import { toolDeclaration, toolSchemaIssues, type ToolDefinition } from '@fudo/tools'
import { Effect } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  jobTools,
  makeJobs,
  makeSubagentTool,
  makeWebSearchTool,
  makeWorkingDirectoryTool,
  tier1Tools,
} from '../src/index.ts'

/** The registry a schema check never calls: only the declarations matter. */
const agents: AgentsShape = {
  create: () => Effect.die('not used by a schema check'),
  get: () => undefined,
  list: () => [],
  dispose: () => Effect.void,
  disposeAll: () => Effect.void,
}

describe('tier 1 tool schemas', () => {
  test('every tool says what it is for and what each parameter means', async () => {
    const ask = await Effect.runPromise(makeAsk())
    const jobs = await Effect.runPromise(makeJobs())
    const root = await mkdtemp(join(tmpdir(), 'fudo-schema-'))
    const tools: ReadonlyArray<ToolDefinition<any, any>> = [
      ...tier1Tools(ask, [root]),
      makeWebSearchTool({ search: () => Effect.succeed([]) }),
      ...jobTools(jobs),
      makeWorkingDirectoryTool({ root, change: () => Effect.void }),
      makeSubagentTool({ agents, route: 'stub/model', parentEvents: () => [] }),
    ]

    const issues = tools.flatMap((tool) => toolSchemaIssues(toolDeclaration(tool)))

    expect(issues).toEqual([])
    await rm(root, { recursive: true, force: true })
  })
})
