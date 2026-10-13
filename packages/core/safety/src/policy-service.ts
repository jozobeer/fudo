import { Context, Layer } from 'effect'
import {
  decide,
  type NeededCapability,
  type PermissionPreset,
  type PolicyDecision,
} from './policy.ts'

export interface PolicyShape {
  readonly preset: PermissionPreset
  readonly decide: (needs: ReadonlyArray<NeededCapability>) => PolicyDecision
}

/** The permission preset of the running profile, as a service tools can depend on. */
export class Policy extends Context.Service<Policy, PolicyShape>()('fudo/Policy') {}

export const policyLayer = (preset: PermissionPreset): Layer.Layer<Policy, never> =>
  Layer.succeed(Policy, { preset, decide: (needs) => decide(preset, needs) })
