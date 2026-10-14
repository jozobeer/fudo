import { describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { seatbeltProfile, seatbeltSandbox } from '../src/index.ts'

describe('seatbeltProfile', () => {
  test('denies by default and allows the configured roots', () => {
    const profile = seatbeltProfile({ writableRoots: ['/work'], readableRoots: ['/usr'] })

    expect(profile).toContain('(version 1)')
    expect(profile).toContain('(deny default)')
    expect(profile).toContain('(subpath "/work")')
    expect(profile).toContain('(subpath "/usr")')
    expect(profile).not.toContain('network')
  })

  test('a profile with no readable roots still lets the system be read', () => {
    const profile = seatbeltProfile({ writableRoots: ['/work'] })

    expect(profile).toContain('(subpath "/usr")')
    expect(profile).toContain('(subpath "/private/etc")')
  })

  test('the root itself is readable, which a subpath rule cannot say', () => {
    const profile = seatbeltProfile({ writableRoots: ['/work'], readableRoots: ['/usr'] })
    const reads = profile.split('(allow file-read*')[1] ?? ''

    expect(reads).toContain('(literal "/")')
    expect(profile.split('(allow file-write*')[1] ?? '').not.toContain('(literal "/")')
  })

  test('a symlinked root is named where it points as well', () => {
    const real = mkdtempSync(join(tmpdir(), 'fudo-root-'))
    const link = real + '-link'
    symlinkSync(real, link)
    try {
      const writes = seatbeltProfile({ writableRoots: [link] }).split('(allow file-write*')[1] ?? ''

      expect(writes).toContain('(subpath "' + link + '")')
      expect(writes).toContain('(subpath "' + realpathSync(link) + '")')
    } finally {
      rmSync(link, { force: true })
      rmSync(real, { recursive: true, force: true })
    }
  })

  test('quotes roots and adds network only on request', () => {
    const profile = seatbeltProfile({ writableRoots: ['/a "b"'], allowNetwork: true })

    expect(profile).toContain('(subpath "/a \\"b\\"")')
    expect(profile).toContain('(allow network*)')
  })
})

describe('seatbeltSandbox', () => {
  test('lets a command write where it runs and in the temp dir', async () => {
    const sandbox = seatbeltSandbox({ writableRoots: [] })
    const wrapped = await Effect.runPromise(
      sandbox.wrap({ argv: ['bash', '-lc', 'echo hi'], cwd: '/work/project' }),
    )
    const writes = (wrapped.argv[2] ?? '').split('(allow file-write*')[1] ?? ''

    expect(writes).toContain('(subpath "/work/project")')
    expect(writes).toContain('(subpath "' + tmpdir() + '")')
  })

  test('wraps argv with sandbox-exec and keeps the cwd', async () => {
    const sandbox = seatbeltSandbox({ writableRoots: ['/work'] })
    const wrapped = await Effect.runPromise(sandbox.wrap({ argv: ['echo', 'hi'], cwd: '/work' }))

    expect(wrapped.argv.slice(0, 4)).toEqual(['sandbox-exec', '-p', wrapped.argv[2] ?? '', '--'])
    expect(wrapped.argv.slice(4)).toEqual(['echo', 'hi'])
    expect(wrapped.argv[2]).toContain('(deny default)')
    expect(wrapped.cwd).toBe('/work')
    expect(sandbox.name).toBe('seatbelt')
  })
})
