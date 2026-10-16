import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Effect } from 'effect'
import type { SandboxShape } from './sandbox.ts'
import type { SandboxMode } from './policy.ts'

/** One SBPL profile's roots, without the mode that decides them. */
export interface SeatbeltProfileOptions {
  /** Directories the sandboxed process may write, on top of its own cwd and the temp dir. */
  readonly writableRoots: ReadonlyArray<string>
  /** Directories it may read; the system paths and every writable root are always readable. */
  readonly readableRoots?: ReadonlyArray<string>
  readonly allowNetwork?: boolean
}

export interface SeatbeltOptions extends SeatbeltProfileOptions {
  /** The mode commands run under unless one call asks for another. */
  readonly mode: SandboxMode
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
  const paths = [
    '/usr',
    '/bin',
    '/sbin',
    '/System',
    '/Library',
    '/etc',
    '/private/etc',
    '/dev',
    '/opt',
  ]
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

/**
 * A root reached through a symlink matches only where it really is, so a rule has to
 * name both: the temp dir is written to as `/var/...` and resolved as `/private/var/...`.
 */
const asRoots = (roots: ReadonlyArray<string>): ReadonlyArray<string> => [
  ...new Set([...roots, ...roots.map(realpathOf)]),
]

/** Builds the SBPL profile macOS sandbox-exec reads. Deny by default. */
export function seatbeltProfile(options: SeatbeltProfileOptions): string {
  const roots = asRoots([...(options.readableRoots ?? systemReadRoots()), ...options.writableRoots])
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process-fork)',
    '(allow sysctl-read)',
    '(allow process-exec)',
    '(allow file-read*',
    subpaths(roots),
    // `subpath` never matches the root itself, and bash reads it as it starts; denied,
    // the shell aborts before it runs a single command.
    '  (literal "/")',
    ')',
  ]
  // An `(allow file-write*)` with no paths after it would grant every path, so a
  // profile that may write nowhere says nothing about writes at all.
  const writable = asRoots(options.writableRoots)
  if (writable.length > 0) {
    lines.push('(allow file-write*', subpaths(writable), ')')
  }
  if (options.allowNetwork === true) {
    lines.splice(4, 0, '(allow network*)')
  }
  return lines.join('\n') + '\n'
}

/**
 * Wraps commands with sandbox-exec on macOS. The mode decides what the command
 * may write: `workspace-write` adds the directory it runs in and the temp dir,
 * `read-only` adds neither, and `danger-full-access` leaves the command as it is.
 */
export function seatbeltSandbox(options: SeatbeltOptions): SandboxShape {
  return {
    name: 'seatbelt',
    confines: true,
    mode: options.mode,
    wrap: (command) => {
      const mode = command.mode ?? options.mode
      if (mode === 'danger-full-access') {
        return Effect.succeed({ argv: command.argv, cwd: command.cwd, mode })
      }
      const implicit = mode === 'workspace-write' ? [command.cwd, tmpdir()] : []
      const writableRoots = [...new Set([...options.writableRoots, ...implicit])]
      const profile = seatbeltProfile({ ...options, writableRoots })
      return Effect.succeed({
        argv: ['sandbox-exec', '-p', profile, '--', ...command.argv],
        cwd: command.cwd,
        mode,
      })
    },
  }
}
