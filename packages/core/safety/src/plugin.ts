import type { Plugin } from '@fudo/kernel'
import { Layer, Schema } from 'effect'
import { Sandbox } from './sandbox.ts'
import { noneSandboxLayer } from './sandbox.ts'
import { seatbeltSandbox } from './seatbelt.ts'
import { Policy } from './policy-service.ts'
import { policyLayer } from './policy-service.ts'

export const safetyConfigSchema = Schema.Struct({
  preset: Schema.Literals(['read-only', 'workspace-write', 'full']),
  sandbox: Schema.optionalKey(Schema.Literals(['none', 'seatbelt'])),
  /** Roots the sandboxed process may write; empty means deny all writes. */
  writableRoots: Schema.optionalKey(Schema.Array(Schema.String)),
})

export type SafetyConfig = Schema.Schema.Type<typeof safetyConfigSchema>

const sandboxLayer = (config: SafetyConfig): Layer.Layer<Sandbox, never> =>
  (config.sandbox ?? 'none') === 'seatbelt'
    ? Layer.succeed(
        Sandbox,
        seatbeltSandbox({
          writableRoots: config.writableRoots ?? [],
        }),
      )
    : noneSandboxLayer

/** Loader definition for the permission preset and the sandbox provider. */
export const safetyPlugin: Plugin<SafetyConfig, Policy | Sandbox, never> = {
  name: '@fudo/safety',
  config: safetyConfigSchema,
  provides: [Policy, Sandbox],
  requires: [],
  layer: (config) => Layer.mergeAll(policyLayer(config.preset), sandboxLayer(config)),
}
