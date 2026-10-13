export * from './read.ts'
export * from './write.ts'
export * from './bash.ts'
export * from './edit.ts'
export * from './glob.ts'
export * from './grep.ts'

import { noneSandbox, type SandboxShape } from '@fudo/safety'
import type { ToolDefinition } from '@fudo/tools'
import { readTool } from './read.ts'
import { writeTool } from './write.ts'
import { editTool } from './edit.ts'
import { globTool } from './glob.ts'
import { grepTool } from './grep.ts'
import { makeBashTool } from './bash.ts'

/** Every Tier 0 tool, with the sandbox the caller chose for bash. */
export const tier0Tools = (
  sandbox: SandboxShape = noneSandbox,
): ReadonlyArray<ToolDefinition<any, any>> => [
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  makeBashTool(sandbox),
]
export * from './plugin.ts'
