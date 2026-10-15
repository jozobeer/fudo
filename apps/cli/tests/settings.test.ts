import { describe, expect, test } from 'bun:test'
import { credentialSource, resolveSettings } from '../src/settings.ts'

const resolve = (overrides: Partial<Parameters<typeof resolveSettings>[0]> = {}) =>
  resolveSettings({
    flags: {},
    settings: {},
    settingsPath: '/home/me/.config/jzh/config.yaml',
    fallbackProfile: 'headless',
    fallbackRoute: 'ollama-cloud/default',
    ...overrides,
  })

describe('what is in effect, and why', () => {
  test('a flag wins over the settings file and over the fallback', () => {
    const resolved = resolve({
      flags: { profile: 'repl', model: 'other/cheap' },
      settings: { profile: 'headless', model: 'ollama-cloud/big' },
    })

    expect(resolved.profile).toEqual({
      value: 'repl',
      source: 'flag',
      from: 'the --profile on the command line',
    })
    expect(resolved.route.value).toBe('other/cheap')
    expect(resolved.route.source).toBe('flag')
  })

  test('the settings file wins over the fallback, and names itself', () => {
    const resolved = resolve({ settings: { profile: 'repl', model: 'ollama-cloud/big' } })

    expect(resolved.profile).toEqual({
      value: 'repl',
      source: 'settings',
      from: '/home/me/.config/jzh/config.yaml',
    })
    expect(resolved.route.value).toBe('ollama-cloud/big')
    expect(resolved.route.source).toBe('settings')
  })

  test('the fallback is a default, and says it is one', () => {
    const resolved = resolve()

    expect(resolved.profile.source).toBe('default')
    expect(resolved.profile.value).toBe('headless')
    expect(resolved.route.value).toBe('ollama-cloud/default')
    expect(resolved.skills).toEqual({
      value: [],
      source: 'default',
      from: 'no skills configured, so the skill tool is off',
    })
    expect(resolved.plugins.value).toEqual([])
  })

  test('a settings file may hold lists, and then it is their source', () => {
    const resolved = resolve({
      settings: {
        skills: ['/home/me/skills'],
        plugins: [{ id: 'mcp', name: '@jozo-harness/mcp' }],
      },
    })

    expect(resolved.skills.value).toEqual(['/home/me/skills'])
    expect(resolved.skills.source).toBe('settings')
    expect(resolved.plugins.value).toHaveLength(1)
    expect(resolved.plugins.source).toBe('settings')
  })

  test('an empty flag is the same as no flag at all', () => {
    const resolved = resolve({ flags: { profile: '' }, settings: { profile: 'repl' } })

    expect(resolved.profile.value).toBe('repl')
    expect(resolved.profile.source).toBe('settings')
  })
})

describe('where a credential came from', () => {
  test('the shell wins, then .env, then secrets.env', () => {
    const environment = { OLLAMA_API_KEY: 'from-shell', OTHER_KEY: 'x' }

    expect(
      credentialSource({ name: 'OLLAMA_API_KEY', environment, fromDotenv: [], fromSecrets: [] }),
    ).toBe('environment')
    expect(
      credentialSource({
        name: 'DOTENV_KEY',
        environment: { DOTENV_KEY: 'x' },
        fromDotenv: ['DOTENV_KEY'],
        fromSecrets: [],
      }),
    ).toBe('dotenv')
    expect(
      credentialSource({
        name: 'SECRET_KEY',
        environment: { SECRET_KEY: 'x' },
        fromDotenv: [],
        fromSecrets: ['SECRET_KEY'],
      }),
    ).toBe('secrets')
  })

  test('a variable nothing defines has no source', () => {
    expect(
      credentialSource({ name: 'MISSING_KEY', environment: {}, fromDotenv: [], fromSecrets: [] }),
    ).toBeUndefined()
    expect(
      credentialSource({
        name: 'EMPTY_KEY',
        environment: { EMPTY_KEY: '' },
        fromDotenv: [],
        fromSecrets: [],
      }),
    ).toBeUndefined()
  })
})
