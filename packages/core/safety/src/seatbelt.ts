import { Effect } from 'effect'
import type { SandboxCommand, SandboxShape } from './sandbox.ts'

export interface SeatbeltOptions {
  /** Directories the sandboxed process may write. */
  readonly writableRoots: ReadonlyArray<string>
  /** Directories it may read; writable roots are always readable. */
  readonly readableRoots?: ReadonlyArray<string>
  readonly allowNetwork?: boolean
}

const quote = (value: string): string =>
  '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'

const subpaths = (roots: ReadonlyArray<string>): string =>
  roots.map((root) => '  (subpath ' + quote(root) + ')').join('\n')

/** Builds the SBPL profile macOS sandbox-exec reads. Deny by default. */
export function seatbeltProfile(options: SeatbeltOptions): string {
  const readable = [...(options.readableRoots ?? []), ...options.writableRoots]
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process-fork)',
    '(allow sysctl-read)',
    '(allow process-exec)',
    '(allow file-read*',
    subpaths(readable),
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

/** Wraps commands with sandbox-exec on macOS. */
export function seatbeltSandbox(options: SeatbeltOptions): SandboxShape {
  const profile = seatbeltProfile(options)
  return {
    name: 'seatbelt',
    wrap: (command: SandboxCommand) =>
      Effect.succeed({
        argv: ['sandbox-exec', '-p', profile, '--', ...command.argv],
        cwd: command.cwd,
      }),
  }
}
