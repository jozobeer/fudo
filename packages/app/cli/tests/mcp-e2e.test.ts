import { agentPlugin } from '@fudo/agent'
import { agentLoopPlugin } from '@fudo/agent-loop'
import { kernelPlugin, type Plugin } from '@fudo/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@fudo/llm'
import { safetyPlugin } from '@fudo/safety'
import { sessionPlugin } from '@fudo/session'
import { jsonlSessions, sessionJsonlPlugin } from '@fudo/session-jsonl'
import { systemPromptPlugin } from '@fudo/system-prompt'
import { mcpPlugin } from '@fudo/tools-tier1'
import { toolsPlugin } from '@fudo/tools'
import { Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/index.ts'

const callEcho: ReadonlyArray<StreamChunk> = [
  {
    type: 'block-end',
    index: 0,
    block: {
      type: 'tool-call',
      id: 'c1',
      name: 'mcp__echo',
      arguments: JSON.stringify({ text: 'hi' }),
    },
  },
  { type: 'finish', kind: 'tool-calls' },
]

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

const stub: Plugin<{}, Llm, never> = {
  name: 'stub-llm',
  config: Schema.Struct({}),
  provides: [Llm],
  requires: [],
  layer: () => {
    let step = 0
    return Layer.succeed(Llm, {
      name: 'stub',
      capabilities: {
        toolChoice: false,
        reasoningEffort: null,
        images: 'none',
        promptCacheControl: false,
      },
      stream: () => {
        const scripts = [callEcho, textTurn('done')]
        const script = scripts[step] ?? []
        step += 1
        return Stream.fromIterable(script)
      },
    } satisfies LlmAdapter)
  },
}

const serverLine =
  'while IFS= read -r line; do id=$(printf "%s" "$line" | sed -n \'s/.*"id":\\([0-9]*\\).*/\\1/p\'); case "$line" in *"tools/list"*) printf \'{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"echo","description":"Echoes"}]}}\\n\' "$id" ;; *) printf \'{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"from mcp"}]}}\\n\' "$id" ;; esac; done'

const profile = (root: string): string =>
  [
    'name: test',
    'plugins:',
    '  - id: kernel',
    "    name: '@fudo/kernel'",
    '  - id: sessions',
    "    name: '@fudo/session'",
    '  - id: session-jsonl',
    "    name: '@fudo/session-jsonl'",
    '    config:',
    '      root: ' + root,
    '  - id: tools',
    "    name: '@fudo/tools'",
    '  - id: system-prompt',
    "    name: '@fudo/system-prompt'",
    '  - id: safety',
    "    name: '@fudo/safety'",
    '    config:',
    '      preset: full',
    '  - id: mcp',
    "    name: '@fudo/mcp'",
    '    config:',
    '      command:',
    '        - bash',
    '        - -lc',
    '        - ' + JSON.stringify(serverLine),
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@fudo/agent'",
    '  - id: agent-loop',
    "    name: '@fudo/agent-loop'",
  ].join('\n')

describe('MCP through the command', () => {
  test("a server's tool is offered and round-trips", async () => {
    const root = await mkdtemp(join(tmpdir(), 'fudo-mcp-'))
    const offered: Array<string> = []
    const spy: Plugin<{}, Llm, never> = {
      ...stub,
      layer: () => {
        let step = 0
        return Layer.succeed(Llm, {
          name: 'stub',
          capabilities: {
            toolChoice: false,
            reasoningEffort: null,
            images: 'none',
            promptCacheControl: false,
          },
          stream: (request) => {
            for (const schema of request.tools ?? []) offered.push(schema.name)
            const scripts = [callEcho, textTurn('done')]
            const script = scripts[step] ?? []
            step += 1
            return Stream.fromIterable(script)
          },
        } satisfies LlmAdapter)
      },
    }

    const code = await Effect.runPromise(
      runCommand({
        profiles: [profile(root)],
        plugins: [
          kernelPlugin,
          sessionJsonlPlugin,
          sessionPlugin,
          toolsPlugin,
          systemPromptPlugin,
          safetyPlugin,
          mcpPlugin,
          spy,
          agentPlugin,
          agentLoopPlugin,
        ] as ReadonlyArray<Plugin<any, any, any>>,
        cwd: '/tmp',
        route: 'stub/model',
        task: 'use the mcp tool',
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    )
    expect(code).toBe(0)

    const sessions = await Effect.runPromise(jsonlSessions({ root }).list())
    const opened = await Effect.runPromise(jsonlSessions({ root }).open(sessions[0]?.id ?? ''))
    const result = opened.events.find((event) => event.type === 'tool/result')

    expect(offered).toContain('mcp__echo')
    expect(result?.type === 'tool/result' ? result.data.isError : true).toBe(false)
    expect(JSON.stringify(result)).toContain('from mcp')
    await rm(root, { recursive: true, force: true })
  })
})
