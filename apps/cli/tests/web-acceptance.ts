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
        const scripts = [
          callBash,
          markdownTurn,
          textTurn('queued answer'),
          longTurn,
          textTurn('still here'),
        ]
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
  if ((await waitFor(() => client.evaluate(activeName()), 'write a long answer')) === undefined) {
    throw new Error('the new session never took the name of its first message')
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

/** The id the rail marks as the session on screen, or '' while it marks none. */
const activeSession = (): string =>
  "(() => { const row = document.querySelector('#session-list button.session.active'); return row === null ? '' : row.dataset.sessionId })()"

const sessionRows = "document.querySelectorAll('#session-list button.session').length"

/** The name the rail shows for the session on screen, or '' while it shows none. */
const activeName = (): string =>
  "(() => { const row = document.querySelector('#session-list button.session.active'); if (row === null) return ''; const name = row.querySelector('.session-name'); return name === null ? '' : name.textContent })()"

/** Waits until the page reads a session other than the one it had. */
const waitForOther = async (client: Cdp, previous: string): Promise<string | undefined> => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await Bun.sleep(250)
    const id = await client.evaluate(activeSession())
    if (typeof id === 'string' && id !== '' && id !== previous) return id
  }
  return undefined
}

/** Moves the page back to the session it started with and waits for its history. */
const switchBack = async (client: Cdp, read: () => Promise<unknown>, id: string): Promise<void> => {
  await client.evaluate(
    "document.querySelector('#session-list button[data-session-id=" +
      JSON.stringify(id) +
      "]').click()",
  )
  if ((await waitFor(read, 'approved and done')) === undefined) {
    throw new Error('the first session never came back')
  }
}

/** Types while the turn waits for an answer; the page must say the input is queued. */
const queuesWhileWaiting = async (client: Cdp, read: () => Promise<unknown>): Promise<void> => {
  await client.evaluate(type('the queued one'))
  if ((await waitFor(read, 'queued')) === undefined) {
    throw new Error('input typed while the turn ran was not shown as queued')
  }
}

/** Waits for the queued input to become its own turn, and for the queue to empty. */
const waitsForTheQueue = async (client: Cdp, read: () => Promise<unknown>): Promise<void> => {
  if ((await waitFor(read, 'queued answer')) === undefined) {
    throw new Error('the queued input never became a turn')
  }
  const stillQueued = await client.evaluate("document.getElementById('queue').innerHTML !== ''")
  if (stillQueued !== false) throw new Error('the queue stayed on screen after it was claimed')
}

/** Asks for a command, answers the approval the page draws, and checks the reply it drew. */
const answersTheApproval = async (client: Cdp, read: () => Promise<unknown>): Promise<string> => {
  await client.evaluate(type('run the command'))
  if ((await waitFor(read, 'Approve bash')) === undefined) {
    throw new Error('the approval never reached the page')
  }
  await queuesWhileWaiting(client, read)
  await client.evaluate('document.querySelector(\'[data-approve="true"]\').click()')
  const answer = await waitFor(read, 'approved and done')
  if (answer === undefined) throw new Error('the reply never reached the page')
  const code = await client.evaluate(
    'document.querySelector(\'pre.code[data-lang="ts"]\') !== null',
  )
  if (code !== true) throw new Error('the fenced block never became a code element')
  const card = await client.evaluate("document.querySelector('details.tool-card') !== null")
  if (card !== true) throw new Error('the tool result never became a card')
  await waitsForTheQueue(client, read)
  // The turn is over: the store names the session and the rail picks the name up.
  if ((await waitFor(() => client.evaluate(activeName()), 'run the command')) === undefined) {
    throw new Error('the rail never picked up the name of the session')
  }
  return answer
}

/** Presses New session and checks the page took it over; returns the session it left. */
const opensANewSession = async (client: Cdp): Promise<string> => {
  const first = await client.evaluate(activeSession())
  if (typeof first !== 'string' || first === '') throw new Error('no session was marked as read')
  if ((await client.evaluate(sessionRows)) !== 1) {
    throw new Error('the first session is not the only row the rail lists')
  }
  await client.evaluate("document.getElementById('new-session').click()")
  if ((await waitForOther(client, first)) === undefined) {
    throw new Error('the page never moved to a new session')
  }
  if ((await client.evaluate(sessionRows)) !== 2) {
    throw new Error('the new session did not join the rail')
  }
  const cleared = await client.evaluate("!document.body.innerText.includes('approved and done')")
  if (cleared !== true) throw new Error('the old conversation stayed on screen')
  return first
}

/** The attribute the stylesheet keys on, or '' while the system's choice stands. */
const themeAttributeOf = 'document.documentElement.dataset.theme ?? ""'
const backgroundOf = 'getComputedStyle(document.body).backgroundColor'

const themeButton = (theme: string): string =>
  "document.querySelector('.theme[data-theme=" + JSON.stringify(theme) + "]').click()"

/** Picks each theme the rail offers and checks the page follows, across a reload. */
const choosesATheme = async (client: Cdp, read: () => Promise<unknown>): Promise<void> => {
  await client.evaluate(themeButton('light'))
  if ((await client.evaluate(themeAttributeOf)) !== 'light') {
    throw new Error('the light choice never reached the document')
  }
  if ((await client.evaluate(backgroundOf)) !== 'rgb(255, 255, 255)') {
    throw new Error('the light palette never applied')
  }
  await client.evaluate(themeButton('system'))
  if ((await client.evaluate(themeAttributeOf)) !== '') {
    throw new Error('the system choice left the attribute behind')
  }
  // The reader's choice and the session the URL names both survive a reload.
  await client.evaluate(themeButton('dark'))
  await client.send('Page.reload')
  if ((await waitFor(read, 'approved and done')) === undefined) {
    throw new Error('the reload never brought the session back')
  }
  if ((await client.evaluate(themeAttributeOf)) !== 'dark') {
    throw new Error('the chosen theme did not survive a reload')
  }
}

/** The rail says what the session works toward, even when it works toward nothing yet. */
const readsTheRun = async (read: () => Promise<unknown>): Promise<void> => {
  if ((await waitFor(read, 'no goal')) === undefined) {
    throw new Error('the rail never said what the session works toward')
  }
}

/** Opens the settings sheet, checks what it says, and closes it again. */
const readsTheSettings = async (client: Cdp, read: () => Promise<unknown>): Promise<void> => {
  await client.evaluate("document.getElementById('settings').click()")
  if ((await waitFor(read, 'Settings')) === undefined) {
    throw new Error('the settings sheet never opened')
  }
  if ((await waitFor(read, 'stub/model')) === undefined) {
    throw new Error('the sheet never showed the model this run asks')
  }
  // This profile has no model endpoint, and the page says so rather than hanging.
  await client.evaluate("document.getElementById('ask-models').click()")
  if ((await waitFor(read, 'no model list')) === undefined) {
    throw new Error('a model list that cannot be asked for was not reported')
  }
  await client.evaluate("document.getElementById('panel-close').click()")
  if ((await client.evaluate("document.getElementById('panel').innerHTML")) !== '') {
    throw new Error('the sheet stayed on screen after it was closed')
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

    if ((await waitFor(read, 'ready')) === undefined) {
      const shown = String(await read())
        .split('\n')
        .join(' | ')
      throw new Error('the page never reported ready: ' + shown.slice(0, 400))
    }
    const answer = await answersTheApproval(client, read)
    await readsTheRun(read)
    const first = await opensANewSession(client)
    await keepsReadingPosition(client, read)
    await switchBack(client, read, first)
    await choosesATheme(client, read)
    await readsTheSettings(client, read)
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
