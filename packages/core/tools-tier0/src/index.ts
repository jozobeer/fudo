export * from './read.ts'
export * from './write.ts'
export * from './workspace.ts'
export * from './present.ts'
export * from './bash.ts'
export * from './edit.ts'
export * from './glob.ts'
export * from './grep.ts'
export * from './walk.ts'
export * from './text.ts'
export * from './observed-files.ts'

import { noneSandbox, type SandboxShape } from '@fudo/safety'
import type { ToolDefinition } from '@fudo/tools'
import { makeReadTool } from './read.ts'
import { makeWriteTool } from './write.ts'
import { makeEditTool } from './edit.ts'
import { globTool } from './glob.ts'
import { grepTool } from './grep.ts'
import { makeBashTool } from './bash.ts'
import { makeObservedFiles, type ObservedFiles } from './observed-files.ts'

/** Every Tier 0 tool, with the sandbox the caller chose for bash. */
export const tier0Tools = (
  sandbox: SandboxShape = noneSandbox,
  observed: ObservedFiles = makeObservedFiles(),
): ReadonlyArray<ToolDefinition<any, any>> => [
  makeReadTool(observed),
  makeWriteTool(observed),
  makeEditTool(observed),
  globTool,
  grepTool,
  makeBashTool(sandbox),
]
export * from './plugin.ts'
