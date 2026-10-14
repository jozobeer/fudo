import { afterAll, describe, expect, test } from 'bun:test'
import { kernelPlugin, loadProfile, parseProfile } from '@fudo/kernel'
import { Sessions, sessionPlugin } from '@fudo/session'
import { sessionJsonlPlugin } from '@fudo/session-jsonl'
import { SystemPrompt, systemPromptPlugin } from '@fudo/system-prompt'
import { Tools, toolsPlugin } from '@fudo/tools'
import { Policy, askPlugin, safetyPlugin } from '@fudo/safety'
import { tier0Plugin } from '@fudo/tools-tier0'
import { tier1Plugin } from '@fudo/tools-tier1'
import { Llm } from '@fudo/llm'
import { llmOpenAiPlugin } from '@fudo/llm-openai'
import { Agents, agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { Context, Effect, Layer } from 'effect'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { loadBundledProfile } from '../src/index.ts'

const tempRoot = join(import.meta.dir, '.tmp')
const plugins = [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  llmOpenAiPlugin,
  agentPlugin,
  agentLoopPlugin,
  safetyPlugin,
  tier0Plugin,
  askPlugin,
  tier1Plugin,
]

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('bundled profile assembly', () => {
  test('resolves every S1 row into one layer and starts an agent', async () => {
    const profile = await Effect.runPromise(parseProfile(await loadBundledProfile()))
    const root = join(tempRoot, crypto.randomUUID())
    const rows = profile.plugins.map((row) =>
      row.id === 'session-jsonl' ? { ...row, config: { root } } : row,
    )

    const built = await Effect.runPromise(
      Effect.gen(function* () {
        const layer = yield* loadProfile({ plugins, layers: [rows] })
        const context = yield* Layer.build(layer)
        const agents = Context.get(context, Agents)
        const agent = yield* agents.create({
          cwd: '/work',
          options: { route: 'ollama-cloud/deepseek-v4.1-flash' },
        })
        return {
          rows: rows.length,
          listed: agents.list().length,
          status: agent.status,
          sessions: Context.get(context, Sessions) !== undefined,
          tools: Context.get(context, Tools).schemas().length,
          prompt: Context.get(context, SystemPrompt)
            .sections()
            .map((section) => section.name),
          llm: Context.get(context, Llm).capabilities.toolChoice,
          preset: Context.get(context, Policy).preset,
        }
      }).pipe(Effect.scoped),
    )

    expect(built).toEqual({
      rows: 12,
      listed: 1,
      status: 'idle',
      sessions: true,
      tools: 0,
      // The prompt layer opens with the built-in identity and tool guidance.
      prompt: ['fudo:identity', 'fudo:tool-guidance'],
      llm: false,
      preset: 'workspace-write',
    })
  })
})
