import { Data, Effect, Layer } from 'effect'
import { Context } from 'effect'

/** The command a tool wants to run, before the sandbox decides how. */
export interface SandboxCommand {
  readonly argv: ReadonlyArray<string>
  readonly cwd: string
}

/** A sandbox that cannot wrap a command. Surfaced as a tool error, not a crash. */
export class SandboxError extends Data.TaggedError('SandboxError')<{
  readonly message: string
}> {}

export interface SandboxShape {
  readonly name: string
  /** Returns the command to actually spawn: the original or one wrapped by the provider. */
  readonly wrap: (command: SandboxCommand) => Effect.Effect<SandboxCommand, SandboxError>
}

export class Sandbox extends Context.Service<Sandbox, SandboxShape>()('jozo-harness/Sandbox') {}

/** Runs commands unchanged; the default when no sandbox provider is configured. */
export const noneSandbox: SandboxShape = {
  name: 'none',
  wrap: (command) => Effect.succeed(command),
}

export const noneSandboxLayer: Layer.Layer<Sandbox, never> = Layer.succeed(Sandbox, noneSandbox)
