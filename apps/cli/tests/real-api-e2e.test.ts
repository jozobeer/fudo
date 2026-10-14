import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { loadBundledProfile } from '@fudo/bundle-base'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { llmOpenAiPlugin } from '@fudo/llm-openai'
import { askPlugin, safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { toolsPlugin } from '@fudo/tools'
import { tier0Plugin } from '@fudo/tools-tier0'
import { tier1Plugin } from '@fudo/tools-tier1'
import { Effect } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

/** The key the shipped profile names; without it this lane asks nobody. */
const KEY = process.env.OLLAMA_API_KEY ?? ''
/** The route to ask; the recorded run used this one. */
const ROUTE = process.env.FUDO_REAL_ROUTE ?? 'ollama-cloud/deepseek-v4.1-flash'

/**
 * The real-API lane: no stub stands in for the provider, so this is the only
 * suite that can prove the shipped profile reaches a model at all. It skips
 * without a key, and it judges the outside world (a file the task asked for),
 * never the model's own words.
 */
describe('the real provider', () => {
  test.skipIf(KEY === '')(
    'a turn writes the file the task asked for',
    async () => {
      const logs = await mkdtemp(join(tmpdir(), 'fudo-real-logs-'))
      const home = await mkdtemp(join(tmpdir(), 'fudo-real-home-'))
      const workspace = await mkdtemp(join(tmpdir(), 'fudo-real-work-'))

      const code = await Effect.runPromise(
        runCommand({
          profiles: [await loadBundledProfile()],
          extraRows: [{ id: 'session-jsonl', name: '@fudo/session-jsonl', config: { root: logs } }],
          plugins: [
            kernelPlugin,
            sessionJsonlPlugin,
            sessionPlugin,
            toolsPlugin,
            systemPromptPlugin,
            safetyPlugin,
            askPlugin,
            tier0Plugin,
            tier1Plugin,
            llmOpenAiPlugin,
            agentPlugin,
            agentLoopPlugin,
          ] as ReadonlyArray<Plugin<any, any, any>>,
          cwd: workspace,
          route: ROUTE,
          task: 'Create a file named real.txt in the working directory whose whole content is the line real-api-ok. Then answer done.',
          fudoHome: home,
          stdout: () => undefined,
          stderr: () => undefined,
        }),
      )

      expect(code).toBe(0)
      expect((await Bun.file(join(workspace, 'real.txt')).text()).trim()).toBe('real-api-ok')

      await rm(logs, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
      await rm(workspace, { recursive: true, force: true })
    },
    180_000,
  )
})
