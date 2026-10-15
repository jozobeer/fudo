import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs } from '../src/args.ts'
import { main, type MainIo } from '../src/bin.ts'

/** A provider that lists `ids` and records the model of every chat request. */
const serveProvider = (ids: ReadonlyArray<string>) => {
  const requested: Array<string> = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      if (path === '/v1/models') return Response.json({ data: ids.map((id) => ({ id })) })
      if (path === '/v1/chat/completions') {
        const body = (await request.json()) as { model: string }
        requested.push(body.model)
      }
      return new Response('stub', { status: 500 })
    },
  })
  return { server, requested, baseUrl: `http://127.0.0.1:${server.port}/v1` }
}

/**
 * Points the llm row at the stub under a key variable of its own, and keeps
 * sessions and the settings file (written only when given) in a temp dir.
 * `tearDown` undoes both.
 */
const setUp = async (baseUrl: string, settings?: string) => {
  const directory = await mkdtemp(join(tmpdir(), 'jozo-harness-models-'))
  const keyEnv = 'JZH_TEST_KEY_' + crypto.randomUUID().replaceAll('-', '_')
  process.env[keyEnv] = 'test-key'
  const patch = join(directory, 'local.yml')
  await Bun.write(
    patch,
    [
      'name: local',
      'plugins:',
      '  - id: llm',
      "    name: '@jozo-harness/llm-openai'",
      '    config:',
      '      baseUrl: ' + baseUrl,
      '      apiKeyEnv: ' + keyEnv,
      '  - id: session-jsonl',
      "    name: '@jozo-harness/session-jsonl'",
      '    config:',
      '      root: ' + join(directory, 'sessions'),
    ].join('\n'),
  )
  const config = join(directory, 'config.yaml')
  if (settings !== undefined) await Bun.write(config, settings)
  const tearDown = async () => {
    delete process.env[keyEnv]
    await rm(directory, { recursive: true, force: true })
  }
  return { tearDown, flags: ['--config', config, '--patch', patch] }
}

const collect = () => {
  const out: Array<string> = []
  const err: Array<string> = []
  const io: MainIo = {
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    cwd: '/work',
  }
  return { io, out, err }
}

const randomIds = (count: number): Array<string> =>
  Array.from({ length: count }, () => 'm-' + crypto.randomUUID().slice(0, 8))

describe('parseArgs models', () => {
  test('a lone models word is the command, not a task', () => {
    const parsed = parseArgs(['models'])
    expect(parsed.models).toBe(true)
    expect(parsed.task).toBeUndefined()
  })

  test('models inside a longer task stays a task', () => {
    const parsed = parseArgs(['models', 'are', 'fun'])
    expect(parsed.models).toBe(false)
    expect(parsed.task).toBe('models are fun')
  })
})

describe('jzh models', () => {
  test('prints one route per line from the profile endpoint', async () => {
    const ids = randomIds(4)
    const { server, baseUrl } = serveProvider(ids)
    const { tearDown, flags } = await setUp(baseUrl)
    const { io, out } = collect()

    const code = await Effect.runPromise(main(['models', ...flags], io))

    server.stop(true)
    await tearDown()
    expect(code).toBe(0)
    expect(out.join('')).toBe(
      ids
        .map((id) => '127.0.0.1/' + id + '\n')
        .sort()
        .join(''),
    )
  })
})

describe('jzh models failures', () => {
  test('an unreachable provider is reported as one line and exits 1', async () => {
    const { server, baseUrl } = serveProvider([])
    server.stop(true)
    const { tearDown, flags } = await setUp(baseUrl)
    const { io, out, err } = collect()

    const code = await Effect.runPromise(main(['models', ...flags], io))

    await tearDown()
    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toHaveLength(1)
    expect(err[0]).toStartWith('jzh: cannot list models from ' + baseUrl + '/models: ')
    expect(err[0]).toEndWith('\n')
    expect(err[0]?.split('\n')).toHaveLength(2)
  })
})

describe('the model a run uses', () => {
  test('without a flag the settings file default is used', async () => {
    const { server, requested, baseUrl } = serveProvider([])
    const model = 'm-' + crypto.randomUUID().slice(0, 8)
    const { tearDown, flags } = await setUp(baseUrl, 'model: x/' + model + '\n')
    const { io } = collect()

    await Effect.runPromise(main([...flags, 'go'], io))

    server.stop(true)
    await tearDown()
    expect(requested).toEqual([model])
  })

  test('the flag wins over the settings file', async () => {
    const { server, requested, baseUrl } = serveProvider([])
    const { tearDown, flags } = await setUp(baseUrl, 'model: x/settings-model\n')
    const { io } = collect()

    await Effect.runPromise(main([...flags, '--model', 'x/flag-model', 'go'], io))

    server.stop(true)
    await tearDown()
    expect(requested).toEqual(['flag-model'])
  })

  test('with no model anywhere the run stops before the provider', async () => {
    const { server, requested, baseUrl } = serveProvider([])
    const { tearDown, flags } = await setUp(baseUrl)
    const { io, err } = collect()

    const code = await Effect.runPromise(main([...flags, 'go'], io))

    server.stop(true)
    await tearDown()
    expect(code).toBe(1)
    expect(err).toEqual([
      'jzh: no model is set: run jzh config set model <provider/model>, or pass --model for one run (jzh models lists them)\n',
    ])
    expect(requested).toEqual([])
  })
})
