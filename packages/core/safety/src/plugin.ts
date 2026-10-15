import { PluginError, type Plugin } from '@jozo-harness/kernel'
import { SystemPrompt } from '@jozo-harness/system-prompt'
import { Effect, Layer, Schema } from 'effect'
import { Sandbox } from './sandbox.ts'
import { noneSandboxLayer } from './sandbox.ts'
import { seatbeltSandbox } from './seatbelt.ts'
import { Ask } from './ask.ts'
import { askServiceLayer } from './ask.ts'
import { Policy, type PolicyShape } from './policy-service.ts'
import { decide, type PermissionPreset } from './policy.ts'

export const safetyConfigSchema = Schema.Struct({
  preset: Schema.Literals(['read-only', 'workspace-write', 'full']),
  sandbox: Schema.optionalKey(Schema.Literals(['none', 'seatbelt'])),
  /** Roots the sandboxed process may write; empty means deny all writes. */
  writableRoots: Schema.optionalKey(Schema.Array(Schema.String)),
})

export type SafetyConfig = Schema.Schema.Type<typeof safetyConfigSchema>

/** The permissions sort after the workspace the loop owns and before the clock. */
const APPROVAL_CONTEXT_ORDER = 20
const SANDBOX_CONTEXT_ORDER = 21

/**
 * The sandbox this platform can actually run. Seatbelt is the default: commands
 * run contained unless the profile says `sandbox: none`, and a platform without
 * the provider fails the loader instead of quietly running unrestricted. The
 * network stays open because the permission policy, not the sandbox, is what
 * decides whether a call may reach out; the sandbox contains the filesystem.
 */
export const sandboxLayerFor = (
  config: SafetyConfig,
  platform: string,
): Layer.Layer<Sandbox, PluginError> =>
  (config.sandbox ?? 'seatbelt') === 'seatbelt'
    ? platform === 'darwin'
      ? Layer.succeed(
          Sandbox,
          seatbeltSandbox({
            writableRoots: config.writableRoots ?? [],
            allowNetwork: true,
          }),
        )
      : Layer.effect(
          Sandbox,
          Effect.fail(
            new PluginError({
              code: 'unavailable',
              message:
                'the seatbelt sandbox runs on macOS only; this is ' +
                platform +
                '. Pass sandbox: none to run commands without one.',
            }),
          ),
        )
    : noneSandboxLayer

/**
 * Policy with the runtime facts that name this profile's permissions. The model
 * reads them from the snapshot instead of inferring what a call would be allowed
 * to do. A duplicate fact name is a programming error, not input.
 */
const policyLayerWithContexts = (config: SafetyConfig): Layer.Layer<Policy, never, SystemPrompt> =>
  Layer.effect(
    Policy,
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt
      yield* prompt.context({
        name: 'approval',
        order: APPROVAL_CONTEXT_ORDER,
        text: () => Effect.succeed('approval: ' + config.preset),
      })
      yield* prompt.context({
        name: 'sandbox',
        order: SANDBOX_CONTEXT_ORDER,
        text: () => Effect.succeed('sandbox: ' + (config.sandbox ?? 'seatbelt')),
      })
      const preset: PermissionPreset = config.preset
      const shape: PolicyShape = { preset, decide: (needs) => decide(preset, needs) }
      return shape
    }).pipe(Effect.orDie),
  )

/** Loader definition for the permission preset and the sandbox provider. */
export const safetyPlugin: Plugin<SafetyConfig, Policy | Sandbox, SystemPrompt> = {
  name: '@jozo-harness/safety',
  config: safetyConfigSchema,
  provides: [Policy, Sandbox],
  requires: [SystemPrompt],
  layer: (config) =>
    Layer.mergeAll(policyLayerWithContexts(config), sandboxLayerFor(config, process.platform)),
}

/** Loader definition for the ask holder: questions wait for an answer. */
export const askPlugin: Plugin<{}, Ask, never> = {
  name: '@jozo-harness/ask',
  config: Schema.Struct({}),
  provides: [Ask],
  requires: [],
  layer: () => askServiceLayer,
}
