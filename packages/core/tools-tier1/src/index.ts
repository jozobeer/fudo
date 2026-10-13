export * from './todo.ts'
export * from './ask.ts'

import type { AskShape } from '@fudo/safety'
import type { ToolDefinition } from '@fudo/tools'
import { askUserToolFor } from './ask.ts'
import { webFetchTool } from './fetch.ts'
import { readImageTool } from './image.ts'
import { makeSkillTool } from './skill.ts'
import { goalTool } from './goal.ts'
import { todoWriteTool } from './todo.ts'

/** Every Tier 1 tool. The ask tool uses the holder the caller installed. */
export const tier1Tools = (
  ask: AskShape,
  skillRoots: ReadonlyArray<string> = [],
): ReadonlyArray<ToolDefinition<any, any>> => [
  todoWriteTool,
  goalTool,
  askUserToolFor(ask),
  webFetchTool,
  readImageTool,
  ...(skillRoots.length === 0 ? [] : [makeSkillTool(skillRoots)]),
]
export * from './plugin.ts'
export * from './skill.ts'
export * from './fetch.ts'
export * from './image.ts'
export * from './subagent.ts'
export * from './cwd-tool.ts'
export * from './goal.ts'
export * from './jobs.ts'
export * from './job-tools.ts'
export * from './search.ts'
export * from './search-provider.ts'
export * from './mcp-codec.ts'
export * from './mcp.ts'
export * from './mcp-tools.ts'
