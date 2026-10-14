import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { llmOpenAiPlugin } from '@fudo/llm-openai'
import { sessionPlugin } from '@fudo/session'
import { sessionJsonlPlugin } from '@fudo/session-jsonl'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { tier0Plugin } from '@fudo/tools-tier0'
import { mcpPlugin, tier1Plugin } from '@fudo/tools-tier1'

/**
 * Every plugin a profile row or a settings row may name.
 *
 * `fudo config` reads this table too, so a name it refuses is a name the loader
 * would refuse at startup.
 */
export const bundledPlugins: ReadonlyArray<Plugin<any, any, any>> = [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  llmOpenAiPlugin,
  agentPlugin,
  agentLoopPlugin,
  safetyPlugin,
  askPlugin,
  tier0Plugin,
  tier1Plugin,
  mcpPlugin,
]
