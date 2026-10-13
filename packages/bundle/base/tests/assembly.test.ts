import { describe, expect, test } from 'bun:test'
import { kernelPlugin, loadProfile, parseProfile } from '@fudo/kernel'
import { Sessions, sessionPlugin } from '@fudo/session'
import { sessionJsonlPlugin } from '@fudo/session-jsonl'
import { SystemPrompt, systemPromptPlugin } from '@fudo/system-prompt'
import { Tools, toolsPlugin } from '@fudo/tools'
import { Llm } from '@fudo/llm'
import { llmOpenAiPlugin } from '@fudo/llm-openai'
import { Agents, agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { Context, Effect, Layer } from 'effect'
import { loadBundledProfile } from '../src/index.ts'

const plugins = [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  llmOpenAiPlugin,
  agentPlugin,
  agentLoopPlugin,
]

describe('bundled profile assembly', () => {
  test('resolves every S1 row into one layer and starts an agent', async () => {
    const profile = await Effect.runPromise(parseProfile(await loadBundledProfile()))

    const built = await Effect.runPromise(
      Effect.gen(function* () {
        const layer = yield* loadProfile({ plugins, layers: [profile.plugins] })
        const context = yield* Layer.build(layer)
        const agents = Context.get(context, Agents)
        const agent = yield* agents.create({
          cwd: '/work',
          options: { route: 'ollama-cloud/kimi-k2.7-code' },
        })
        return {
          rows: profile.plugins.length,
          listed: agents.list().length,
          status: agent.status,
          sessions: Context.get(context, Sessions) !== undefined,
          tools: Context.get(context, Tools).schemas().length,
          prompt: Context.get(context, SystemPrompt).sections().length,
          llm: Context.get(context, Llm).capabilities.toolChoice,
        }
      }).pipe(Effect.scoped),
    )

    expect(built).toEqual({
      rows: 8,
      listed: 1,
      status: 'idle',
      sessions: true,
      tools: 0,
      prompt: 0,
      llm: false,
    })
  })
})
