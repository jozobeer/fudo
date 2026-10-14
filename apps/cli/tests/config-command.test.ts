import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runConfig } from '../src/config-command.ts'
import { loadConfigFile } from '../src/config-file.ts'

const collector = () => {
  const out: Array<string> = []
  const errs: Array<string> = []
  return {
    io: {
      stdout: (text: string) => void out.push(text),
      stderr: (text: string) => void errs.push(text),
    },
    out,
    errs,
  }
}

const withHome = async (body: (env: Record<string, string>, path: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), 'fudo-config-'))
  try {
    await body({ XDG_CONFIG_HOME: directory }, join(directory, 'fudo', 'config.yaml'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('fudo config', () => {
  test('shows where the settings live and what they hold', async () => {
    await withHome(async (env, path) => {
      const sink = collector()

      const code = await runConfig([], sink.io, env)

      const text = sink.out.join('')
      expect(code).toBe(0)
      expect(text).toContain('settings (' + path + '):')
      expect(text).toContain('- model: not set')
      expect(text).toContain('fudo config set model')
      expect(text).toContain('fudo config init')
    })
  })

  test('shows the values a settings file holds', async () => {
    await withHome(async (env, path) => {
      const sink = collector()
      await runConfig(['set', 'model', 'my-cloud/some-model'], sink.io, env)
      const shown = collector()

      const code = await runConfig([], shown.io, env)

      expect(code).toBe(0)
      expect(shown.out.join('')).toContain('- model: my-cloud/some-model ')
      expect(readFileSync(path, 'utf8')).toContain('model: my-cloud/some-model')
    })
  })

  test('sets a key in a file it creates', async () => {
    await withHome(async (env, path) => {
      const sink = collector()

      const code = await runConfig(['set', 'model', 'my-cloud/some-model'], sink.io, env)

      expect(code).toBe(0)
      expect(sink.out.join('')).toContain('model: my-cloud/some-model')
      const settings = await Effect.runPromise(loadConfigFile(path))
      expect(settings.model).toBe('my-cloud/some-model')
    })
  })

  test('keeps the other lines and the comments', async () => {
    await withHome(async (env, path) => {
      const sink = collector()
      await runConfig(['set', 'profile', 'repl'], sink.io, env)
      const first = readFileSync(path, 'utf8')

      const code = await runConfig(['set', 'model', 'my-cloud/next'], sink.io, env)

      const text = readFileSync(path, 'utf8')
      expect(code).toBe(0)
      expect(text).toContain('profile: repl')
      expect(text).toContain('model: my-cloud/next')
      expect(text.startsWith(first)).toBe(true)
    })
  })

  test('refuses a key the settings file does not take', async () => {
    await withHome(async (env) => {
      const sink = collector()

      const code = await runConfig(['set', 'nope', 'x'], sink.io, env)

      expect(code).toBe(2)
      expect(sink.errs.join('')).toContain('model, profile, skills, plugins')
    })
  })

  test('refuses to set a key that holds a list', async () => {
    await withHome(async (env, path) => {
      const sink = collector()

      const code = await runConfig(['set', 'skills', '/tmp/skills'], sink.io, env)

      expect(code).toBe(2)
      expect(sink.errs.join('')).toContain('edit ' + path)
    })
  })

  test('refuses a model that is not provider/model', async () => {
    await withHome(async (env) => {
      const sink = collector()

      const code = await runConfig(['set', 'model', 'nonsense'], sink.io, env)

      expect(code).toBe(2)
      expect(sink.errs.join('')).toContain('provider/model')
    })
  })

  test('refuses a profile that is not bundled', async () => {
    await withHome(async (env) => {
      const sink = collector()

      const code = await runConfig(['set', 'profile', 'nope'], sink.io, env)

      expect(code).toBe(2)
      expect(sink.errs.join('')).toContain('no bundled profile named nope')
    })
  })

  test('init writes a starting file with every key commented out', async () => {
    await withHome(async (env, path) => {
      const sink = collector()

      const code = await runConfig(['init'], sink.io, env)

      expect(code).toBe(0)
      expect(sink.out.join('')).toContain(path)
      const text = readFileSync(path, 'utf8')
      for (const key of ['model', 'profile', 'skills', 'plugins']) {
        expect(text).toContain('# ' + key + ':')
      }
      const settings = await Effect.runPromise(loadConfigFile(path))
      expect(settings).toEqual({})
    })
  })

  test('init does not overwrite a file that is there', async () => {
    await withHome(async (env, path) => {
      const sink = collector()
      await runConfig(['set', 'model', 'my-cloud/some-model'], sink.io, env)

      const code = await runConfig(['init'], sink.io, env)

      expect(code).toBe(1)
      expect(sink.errs.join('')).toContain('already exists')
      expect(readFileSync(path, 'utf8')).toContain('my-cloud/some-model')
    })
  })
})
