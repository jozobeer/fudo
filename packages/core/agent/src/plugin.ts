import { Hooks, type Plugin } from '@fudo/kernel'
import { Sessions } from '@fudo/session'
import { Schema } from 'effect'
import { AgentRunnerService, Agents, agentsFromServiceLayer } from './agents.ts'

/** Loader definition for the agent registry. */
export const agentPlugin: Plugin<{}, Agents, Sessions | Hooks | AgentRunnerService> = {
  name: '@fudo/agent',
  config: Schema.Struct({}),
  provides: [Agents],
  requires: [Sessions, Hooks, AgentRunnerService],
  layer: () => agentsFromServiceLayer,
}
