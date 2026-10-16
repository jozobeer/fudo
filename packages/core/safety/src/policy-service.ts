import { Context, Layer } from 'effect'
import { modeOf, type PermissionPreset, type SandboxMode } from './policy.ts'

export interface PolicyShape {
  readonly preset: PermissionPreset
  /** The sandbox mode this preset's commands run under. */
  readonly mode: SandboxMode
}

/** The permission preset of the running profile, as a service tools can depend on. */
export class Policy extends Context.Service<Policy, PolicyShape>()('jozo-harness/Policy') {}

export const policyLayer = (preset: PermissionPreset): Layer.Layer<Policy, never> =>
  Layer.succeed(Policy, { preset, mode: modeOf(preset) })
