import { agentPlugin } from '@jozo-harness/agent'
import { agentLoopPlugin } from '@jozo-harness/agent-loop'
import { kernelPlugin, type Plugin } from '@jozo-harness/kernel'
import { Llm, type LlmAdapter, type StreamChunk } from '@jozo-harness/llm'
import { safetyPlugin } from '@jozo-harness/safety'
import { sessionPlugin } from '@jozo-harness/session'
import { sessionJsonlPlugin } from '@jozo-harness/session-jsonl'
import { systemPromptPlugin } from '@jozo-harness/system-prompt'
import { tier0Plugin } from '@jozo-harness/tools-tier0'
import { toolsPlugin } from '@jozo-harness/tools'
import { Deferred, Effect, Layer, Schema, Stream } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { runCommand } from '../src/index.ts'

/**
 * Acceptance for S8: a real Chrome types a message, answers the approval prompt
 * the page draws, and receives the reply. Only the model is stubbed. Run it
 * with `bun run tests/web-acceptance.ts`.
 */

const textTurn = (text: string): ReadonlyArray<StreamChunk> => [
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', kind: 'stop' },
]

/** The page must show the approval prompt, so the call asks for a wider mode. */
const callBash: ReadonlyArray<StreamChunk> = [
  {
    type: 'block-end',
    index: 0,
    block: {
      type: 'tool-call',
      id: 'c1',
      name: 'bash',
      arguments: JSON.stringify({
        command: 'echo ran',
        sandbox_permissions: 'danger-full-access',
        justification: 'the acceptance asks the page for the wider mode',
      }),
    },
  },
  { type: 'finish', kind: 'tool-calls' },
]

/** Long enough that the conversation scrolls, which the follow check needs. */
const markdownTurn = textTurn('approved and done\n\n```ts\nlet a = 1\n```')

const longTurn = textTurn(
  Array.from({ length: 60 }, (_, index) => 'line-' + String(index + 1).padStart(2, '0')).join('\n'),
)

const stubLlm: Plugin<{}, Llm, never> = {
  name: 'stub-llm',
  config: Schema.Struct({}),
  provides: [Llm],
  requires: [],
  layer: () => {
    let call = 0
    return Layer.succeed(Llm, {
      name: 'stub',
      capabilities: {
        toolChoice: false,
        reasoningEffort: null,
        images: 'none',
        promptCacheControl: false,
      },
      stream: () => {
        const scripts = [callBash, markdownTurn, longTurn, textTurn('still here')]
        const script = scripts[call] ?? []
        call += 1
        return Stream.fromIterable(script)
      },
    } satisfies LlmAdapter)
  },
}

const profile = (root: string): string =>
  [
    'name: test',
    'plugins:',
    '  - id: kernel',
    "    name: '@jozo-harness/kernel'",
    '  - id: sessions',
    "    name: '@jozo-harness/session'",
    '  - id: session-jsonl',
    "    name: '@jozo-harness/session-jsonl'",
    '    config:',
    '      root: ' + root,
    '  - id: tools',
    "    name: '@jozo-harness/tools'",
    '  - id: system-prompt',
    "    name: '@jozo-harness/system-prompt'",
    '  - id: safety',
    "    name: '@jozo-harness/safety'",
    '    config:',
    '      preset: workspace-write',
    // The page answers an escalation, so the command stands under the preset.
    '      sandbox: seatbelt',
    '  - id: tier0',
    "    name: '@jozo-harness/tools-tier0'",
    '  - id: llm',
    '    name: stub-llm',
    '  - id: agent',
    "    name: '@jozo-harness/agent'",
    '  - id: agent-loop',
    "    name: '@jozo-harness/agent-loop'",
  ].join('\n')

const plugins: ReadonlyArray<Plugin<any, any, any>> = [
  kernelPlugin,
  sessionJsonlPlugin,
  sessionPlugin,
  toolsPlugin,
  systemPromptPlugin,
  safetyPlugin,
  tier0Plugin,
  stubLlm,
  agentPlugin,
  agentLoopPlugin,
]

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const evidence = join(repoRoot, '.tmp/web-evidence.png')

interface Cdp {
  readonly send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  readonly evaluate: (expression: string) => Promise<unknown>
  readonly close: () => void
}

const connectCdp = async (wsUrl: string): Promise<Cdp> => {
  const socket = new WebSocket(wsUrl)
  let nextId = 0
  const pending = new Map<number, (value: unknown) => void>()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number }
    if (message.id === undefined) return
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('cannot attach to the page')))
  })
  const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
    new Promise((resolve) => {
      const id = nextId
      nextId += 1
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression: string): Promise<unknown> => {
    const response = (await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result?: { result?: { value?: unknown } } }
    return response.result?.result?.value
  }
  return { send, evaluate, close: () => socket.close() }
}

const waitFor = async (
  read: () => Promise<unknown>,
  wanted: string,
  attempts = 60,
): Promise<string | undefined> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await Bun.sleep(250)
    const value = await read()
    if (typeof value === 'string' && value.includes(wanted)) return value
  }
  return undefined
}

interface BrowserOutcome {
  readonly passed: boolean
  readonly answer: string
}

/** The debug port Chrome selected, once it has written it down. */
const debugPort = async (profileDir: string): Promise<string> => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await Bun.sleep(250)
    const file = Bun.file(join(profileDir, 'DevToolsActivePort'))
    if (!(await file.exists())) continue
    const port = (await file.text()).split('\n')[0] ?? ''
    if (port !== '') return port
  }
  throw new Error('chrome never wrote DevToolsActivePort')
}

/** The page target Chrome opened for us, never an extension or a browser UI. */
const pageTargetOf = async (port: string, url: string): Promise<string> => {
  const response = await fetch('http://127.0.0.1:' + port + '/json/list')
  const targets = (await response.json()) as ReadonlyArray<{
    type: string
    url: string
    webSocketDebuggerUrl: string
  }>
  const page = targets.find((target) => target.type === 'page' && target.url.startsWith(url))
  if (page === undefined) throw new Error('chrome never opened the page')
  return page.webSocketDebuggerUrl
}

const saveScreenshot = async (client: Cdp): Promise<void> => {
  const shot = (await client.send('Page.captureScreenshot', { format: 'png' })) as {
    result?: { data?: string }
  }
  const data = shot.result?.data
  if (data !== undefined) await Bun.write(evidence, Buffer.from(data, 'base64'))
}

const type = (value: string): string =>
  "(() => { const input = document.getElementById('input'); input.value = " +
  JSON.stringify(value) +
  "; input.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('composer').requestSubmit(); return true })()"

/** Puts the reader at the top of the conversation and reports where they landed. */
const readFromTop = (): string =>
  "(() => { const box = document.getElementById('conversation'); box.scrollTop = 0; return box.scrollTop })()"

const scrollTop = 'document.getElementById("conversation").scrollTop'

/** A reader above the fold keeps their place while more output arrives. */
const keepsReadingPosition = async (client: Cdp, read: () => Promise<unknown>): Promise<void> => {
  await client.evaluate(type('write a long answer'))
  if ((await waitFor(read, 'line-60')) === undefined) {
    throw new Error('the long reply never reached the page')
  }
  if ((await client.evaluate(readFromTop())) !== 0) {
    throw new Error('the conversation never scrolled')
  }
  await client.evaluate(type('one more'))
  if ((await waitFor(read, 'still here')) === undefined) {
    throw new Error('the last reply never reached the page')
  }
  const kept = await client.evaluate(scrollTop)
  if (kept !== 0) {
    throw new Error(
      'the view was pulled to the bottom while the reader was above it: ' + String(kept),
    )
  }
}

const driveBrowser = async (url: string, profileDir: string): Promise<BrowserOutcome> => {
  const browser = Bun.spawn(
    [
      chrome,
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profileDir,
      url + '/',
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  )
  let cdp: Cdp | undefined
  try {
    const port = await debugPort(profileDir)
    const client = await connectCdp(await pageTargetOf(port, url))
    cdp = client
    await client.send('Runtime.enable')
    const read = (): Promise<unknown> => client.evaluate('document.body.innerText')

    const shown = async (): Promise<string> =>
      String(await read())
        .split('\n')
        .join(' | ')
    if ((await waitFor(read, 'ready')) === undefined) {
      throw new Error('the page never reported ready: ' + (await shown()).slice(0, 400))
    }
    await client.evaluate(type('run the command'))
    if ((await waitFor(read, 'Approve bash')) === undefined) {
      throw new Error('the approval never reached the page: ' + (await shown()).slice(0, 400))
    }
    await client.evaluate('document.querySelector(\'[data-approve="true"]\').click()')
    const answer = await waitFor(read, 'approved and done')
    if (answer === undefined) throw new Error('the reply never reached the page')
    const code = await client.evaluate(
      'document.querySelector(\'pre.code[data-lang="ts"]\') !== null',
    )
    if (code !== true) throw new Error('the fenced block never became a code element')
    const card = await client.evaluate("document.querySelector('details.tool-card') !== null")
    if (card !== true) throw new Error('the tool result never became a card')

    await keepsReadingPosition(client, read)
    await saveScreenshot(client)
    return { passed: true, answer }
  } finally {
    cdp?.close()
    browser.kill()
  }
}

/** The server hands the browser a built bundle, so a stale dist would test the wrong page. */
const buildWeb = async (): Promise<void> => {
  const built = Bun.spawnSync(['bun', 'run', 'build'], {
    cwd: join(repoRoot, 'apps/web'),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (built.exitCode !== 0) throw new Error('the web bundle did not build')
}

const main = async (): Promise<number> => {
  const root = await mkdtemp(join(tmpdir(), 'jozo-harness-web-accept-'))
  const workspace = await mkdtemp(join(tmpdir(), 'jozo-harness-web-accept-ws-'))
  const profileDir = join(repoRoot, '.tmp/chrome-cdp')
  await rm(profileDir, { recursive: true, force: true })
  await buildWeb()

  const outcome = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<string>()
        const stop = yield* Deferred.make<void>()
        yield* Effect.forkScoped(
          runCommand({
            profiles: [profile(root)],
            plugins,
            cwd: workspace,
            route: 'stub/model',
            web: { port: 0 },
            stdout: () => undefined,
            stderr: (text) => {
              const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(text)
              if (match !== null) void Effect.runSync(Deferred.succeed(ready, match[0]))
            },
            interrupt: Deferred.await(stop),
          }),
        )
        const url = (yield* Deferred.await(ready)).replace(/\/$/, '')
        console.log('server', url)
        const result = yield* Effect.promise(() => driveBrowser(url, profileDir))
        yield* Deferred.succeed(stop, undefined)
        return result
      }),
    ),
  )

  await rm(root, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
  if (outcome.passed) {
    console.log(
      'page:',
      outcome.answer
        .split('\n')
        .filter((line) => line !== '')
        .join(' | '),
    )
    console.log('screenshot:', evidence)
  }
  console.log(outcome.passed ? 'ACCEPTANCE PASS' : 'ACCEPTANCE FAIL')
  return outcome.passed ? 0 : 1
}

process.exitCode = await main()
