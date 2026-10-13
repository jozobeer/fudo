import type { ToolRestriction } from '@fudo/tools'
import { Effect, type Scope } from 'effect'
import type { ToolRegistry } from '@fudo/tools'

/** The tools plan mode leaves visible: reading and talking, never changing. */
export const PLAN_MODE_TOOLS: ReadonlyArray<string> = [
  'read',
  'glob',
  'grep',
  'skill',
  'todo_write',
  'ask_user',
]

/** A restriction that hides every tool that could change the workspace. */
export const planModeRestriction = (
  allowed: ReadonlyArray<string> = PLAN_MODE_TOOLS,
): ToolRestriction => ({
  name: 'plan-mode',
  allows: (tool) => allowed.includes(tool),
})

/** Registers the plan-mode restriction until the surrounding scope closes. */
export const installPlanMode = (
  tools: ToolRegistry,
  allowed: ReadonlyArray<string> = PLAN_MODE_TOOLS,
): Effect.Effect<void, never, Scope.Scope> => tools.restrict(planModeRestriction(allowed))
