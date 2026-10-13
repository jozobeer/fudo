export * from './todo.ts'
export * from './ask.ts'

import type { AskShape } from '@fudo/safety'
import type { ToolDefinition } from '@fudo/tools'
import { askUserToolFor } from './ask.ts'
import { todoWriteTool } from './todo.ts'

/** Every Tier 1 tool. The ask tool uses the holder the caller installed. */
export const tier1Tools = (ask: AskShape): ReadonlyArray<ToolDefinition<any, any>> => [
  todoWriteTool,
  askUserToolFor(ask),
]
