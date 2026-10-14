import type { ToolRegistry, ToolRestriction } from '@fudo/tools'
import { Effect, type Scope } from 'effect'

/** The tools plan mode leaves visible: reading, talking, and the way out. */
export const PLAN_MODE_TOOLS: ReadonlyArray<string> = [
  'read',
  'glob',
  'grep',
  'skill',
  'todo_write',
  'ask_user',
  'exit_plan_mode',
]

/** The word that answers yes to a question this harness asks about its own actions. */
export const APPROVAL_ANSWER = 'approve'
/** What the user answers to approve a plan; any other words keep plan mode. */
export const PLAN_APPROVAL = APPROVAL_ANSWER

/** A restriction that hides every tool that could change the workspace while it is active. */
export const planModeRestriction = (
  active: () => boolean,
  allowed: ReadonlyArray<string> = PLAN_MODE_TOOLS,
): ToolRestriction => ({
  name: 'plan-mode',
  allows: (tool) => !active() || allowed.includes(tool),
})

/**
 * Plan mode as one object. The restriction is registered once and consults this
 * object on every call, so the tool that ends plan mode can lift it while the
 * session keeps running: the next `schemas` and `call` see the workspace-changing
 * tools again.
 */
export interface PlanModeShape {
  /** Whether the workspace-changing tools are hidden right now. */
  readonly active: () => boolean
  /** Registers the restriction until the surrounding scope closes. */
  readonly install: (
    tools: ToolRegistry,
    allowed?: ReadonlyArray<string>,
  ) => Effect.Effect<void, never, Scope.Scope>
  /** Ends plan mode. There is no way back in. */
  readonly leave: () => void
}

export const makePlanMode = (): PlanModeShape => {
  let planning = true
  return {
    active: () => planning,
    install: (tools, allowed = PLAN_MODE_TOOLS) =>
      tools.restrict(planModeRestriction(() => planning, allowed)),
    leave: () => {
      planning = false
    },
  }
}
