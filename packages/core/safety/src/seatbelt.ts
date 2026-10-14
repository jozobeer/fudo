import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Effect } from 'effect'
import type { SandboxCommand, SandboxShape } from './sandbox.ts'

export interface SeatbeltOptions {
  /** Directories the sandboxed process may write, on top of its own cwd and the temp dir. */
  readonly writableRoots: ReadonlyArray<string>
  /** Directories it may read; the system paths and every writable root are always readable. */
  readonly readableRoots?: ReadonlyArray<string>
  readonly allowNetwork?: boolean
}

const quote = (value: string): string =>
  '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'

const subpaths = (roots: ReadonlyArray<string>): string =>
  roots.map((root) => '  (subpath ' + quote(root) + ')').join('\n')

/**
 * What a process on this machine has to read to run at all: the toolchain, the
 * system libraries, the device nodes, and the temp dir. A sandbox that denies
 * everything needs this list, or bash cannot even load.
 */
export const systemReadRoots = (): ReadonlyArray<string> => {
  const paths = ['/usr', '/bin', '/sbin', '/System', '/Library', '/private/etc', '/dev', '/opt']
  const temp = tmpdir()
  return [...paths, temp, ...(realpathOf(temp) === temp ? [] : [realpathOf(temp)])]
}

/** The path a sandbox sees: on macOS the temp dir is reached through /private. */
const realpathOf = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Builds the SBPL profile macOS sandbox-exec reads. Deny by default. */
export function seatbeltProfile(options: SeatbeltOptions): string {
  const roots = [
    ...new Set([
      ...(options.readableRoots ?? systemReadRoots()),
      ...options.writableRoots,
      ...options.writableRoots.map(realpathOf),
    ]),
  ]
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process-fork)',
    '(allow sysctl-read)',
    '(allow process-exec)',
    '(allow file-read*',
    subpaths(roots),
    ')',
    '(allow file-write*',
    subpaths(options.writableRoots),
    ')',
  ]
  if (options.allowNetwork === true) {
    lines.splice(4, 0, '(allow network*)')
  }
  return lines.join('\n') + '\n'
}

/**
 * Wraps commands with sandbox-exec on macOS. The workspace a command runs in and
 * the temp dir are writable without being configured: without them no command that
 * writes anything could run at all.
 */
export function seatbeltSandbox(options: SeatbeltOptions): SandboxShape {
  return {
    name: 'seatbelt',
    wrap: (command: SandboxCommand) => {
      const writableRoots = [...new Set([...options.writableRoots, command.cwd, tmpdir()])]
      const profile = seatbeltProfile({ ...options, writableRoots })
      return Effect.succeed({
        argv: ['sandbox-exec', '-p', profile, '--', ...command.argv],
        cwd: command.cwd,
      })
    },
  }
}
