import { Hooks, type Plugin } from '@jozo-harness/kernel'
import { Sessions } from '@jozo-harness/session'
import { Schema } from 'effect'
import { AgentRunnerService, Agents, agentsFromServiceLayer } from './agents.ts'

/** Loader definition for the agent registry. */
export const agentPlugin: Plugin<{}, Agents, Sessions | Hooks | AgentRunnerService> = {
  name: '@jozo-harness/agent',
  config: Schema.Struct({}),
  provides: [Agents],
  requires: [Sessions, Hooks, AgentRunnerService],
  layer: () => agentsFromServiceLayer,
}
