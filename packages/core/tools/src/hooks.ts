import type { Emit, Waterfall } from '@fudo/kernel'
import type { Effect } from 'effect'
import type { PreExecuteDecision, ToolExecution, ToolExecutionResult } from './types.ts'

declare module '@fudo/kernel/hook' {
  interface HookMap {
    'tools/pre-execute': Waterfall<(exec: ToolExecution) => Effect.Effect<PreExecuteDecision>>
    'tools/execute': Waterfall<(exec: ToolExecution) => Effect.Effect<ToolExecutionResult>>
    'tools/post-execute': Waterfall<
      (exec: ToolExecution, result: ToolExecutionResult) => Effect.Effect<ToolExecutionResult>
    >
    'tools/result': Emit<(result: ToolExecutionResult) => void>
  }
}
