import type { Serial } from '@fudo/kernel'
import type { Effect } from 'effect'
import type { Agent, AgentInitError } from './types.ts'

declare module '@fudo/kernel/hook' {
  interface HookMap {
    /** Runs before an agent starts working. A failure rolls the create back. */
    'agent/created': Serial<(agent: Agent) => Effect.Effect<void, AgentInitError>>
  }
}
