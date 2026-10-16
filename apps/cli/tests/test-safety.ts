import type { Plugin } from '@jozo-harness/kernel'
import { Policy, Sandbox, type SandboxShape } from '@jozo-harness/safety'
import { Effect, Layer, Schema } from 'effect'

/**
 * A sandbox that refuses every command the way seatbelt refuses a file effect,
 * and runs it as it is under a wider mode — what an unconfined provider does. The
 * escalation tests cannot nest a real seatbelt inside the sandbox they run in.
 */
export const confiningSandbox: SandboxShape = {
  name: 'test-confine',
  confines: true,
  mode: 'workspace-write',
  wrap: (command) => {
    const mode = command.mode ?? 'workspace-write'
    if (mode !== 'workspace-write') {
      return Effect.succeed({ argv: command.argv, cwd: command.cwd, mode, denialSignatures: [] })
    }
    return Effect.succeed({
      argv: [
        'bash',
        '-lc',
        'printf "%s\\n" "bash: /etc/hosts: Operation not permitted" >&2; exit 1',
      ],
      cwd: command.cwd,
      mode,
      denialSignatures: ['operation not permitted'],
    })
  },
}

/** Stands in for the safety row: the same services, a sandbox that always denies. */
export const testSafety: Plugin<{}, Policy | Sandbox, never> = {
  name: 'test-safety',
  config: Schema.Struct({}),
  provides: [Policy, Sandbox],
  requires: [],
  layer: () =>
    Layer.merge(
      Layer.succeed(Policy, { preset: 'workspace-write', mode: 'workspace-write' }),
      Layer.succeed(Sandbox, confiningSandbox),
    ),
}
