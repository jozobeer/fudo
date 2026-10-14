import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Effect } from 'effect'
import { describe, expect, test } from 'bun:test'
import { loadConfigFile, parseConfigText } from '../src/index.ts'
import { main, type MainIo } from '../src/bin.ts'

const io = (sink: Array<string>, errs: Array<string>): MainIo => ({
  stdout: (text) => void sink.push(text),
  stderr: (text) => void errs.push(text),
  cwd: '/tmp',
})

describe('parseConfigText', () => {
  test('reads defaults and plugin rows', async () => {
    const config = await Effect.runPromise(
      parseConfigText(
        [
          'model: my-cloud/some-model',
          'profile: repl',
          'skills:',
          '  - /tmp/skills',
          'unknown_key: ignored',
          'plugins:',
          '  - id: safety',
          "    name: '@fudo/safety'",
          '    config:',
          '      preset: full',
        ].join('\n'),
      ),
    )

    expect(config.model).toBe('my-cloud/some-model')
    expect(config.profile).toBe('repl')
    expect(config.skills).toEqual(['/tmp/skills'])
    expect(config.plugins?.length).toBe(1)
    expect(config.plugins?.[0]?.id).toBe('safety')
  })

  test('reports invalid YAML as a config error', async () => {
    const failed = await Effect.runPromise(
      Effect.match(parseConfigText('model: [unclosed'), {
        onFailure: (error) => error.code + ': ' + error.message.slice(0, 30),
        onSuccess: () => 'parsed',
      }),
    )

    expect(failed).toContain('config:')
  })

  test('a missing file is no settings', async () => {
    const config = await Effect.runPromise(loadConfigFile('/tmp/fudo-no-settings-here.yaml'))

    expect(config).toEqual({})
  })
})

describe('the settings file through the command', () => {
  test('its plugin rows join the profile and --dump-config shows them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fudo-settings-'))
    const xdg = join(directory, 'fudo')
    await Bun.write(
      join(directory, 'config.yaml'),
      [
        'plugins:',
        '  - id: safety',
        "    name: '@fudo/safety'",
        '    config:',
        '      preset: full',
      ].join('\n'),
    )
    void xdg

    const out: Array<string> = []
    const errs: Array<string> = []
    const code = await Effect.runPromise(
      main(['--dump-config', '--config', join(directory, 'config.yaml')], io(out, errs)),
    )

    expect(code).toBe(0)
    expect(out.join('')).toContain('"preset":"full"')
    await rm(directory, { recursive: true, force: true })
  })

  test('--dump-config names the settings file and shows what it holds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fudo-settings-path-'))
    const path = join(directory, 'config.yaml')
    await Bun.write(path, 'model: my-cloud/some-model\n')

    const out: Array<string> = []
    const code = await Effect.runPromise(main(['--dump-config', '--config', path], io(out, [])))

    const text = out.join('')
    expect(code).toBe(0)
    expect(text).toContain('settings (' + path + '):')
    expect(text).toContain('  - model: my-cloud/some-model ')
    expect(text).toContain('model in effect: my-cloud/some-model')
    await rm(directory, { recursive: true, force: true })
  })

  test('a malformed settings file stops the run with a message', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fudo-settings-bad-'))
    const path = join(directory, 'config.yaml')
    await Bun.write(path, 'model: [unclosed')

    const out: Array<string> = []
    const errs: Array<string> = []
    const code = await Effect.runPromise(main(['--dump-config', '--config', path], io(out, errs)))

    expect(code).toBe(1)
    expect(errs.join('')).toContain('settings are not valid YAML')
    await rm(directory, { recursive: true, force: true })
  })
})
