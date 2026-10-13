/** A named permission level a profile chooses. */
export type PermissionPreset = 'read-only' | 'workspace-write' | 'full'

/** What a tool declared it needs; see ToolNeeds in @fudo/tools. */
export type NeededCapability = 'read' | 'write' | 'exec' | 'network'

export const KNOWN_CAPABILITIES: ReadonlyArray<NeededCapability> = [
  'read',
  'write',
  'exec',
  'network',
]

export type PolicyDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'ask'; readonly reason: string }
  | { readonly kind: 'deny'; readonly reason: string }

const PRESETS: Readonly<Record<PermissionPreset, ReadonlyArray<NeededCapability>>> = {
  'read-only': ['read', 'network'],
  'workspace-write': ['read', 'network', 'write'],
  full: ['read', 'network', 'write', 'exec'],
}

/** True when this one capability is inside the preset. */
export function allows(preset: PermissionPreset, need: NeededCapability): boolean {
  return PRESETS[preset].includes(need)
}

/**
 * Judges one call against the preset. Anything outside the preset becomes an
 * escalation request; an unknown capability or preset is denied outright.
 */
export function decide(
  preset: PermissionPreset,
  needs: ReadonlyArray<NeededCapability>,
): PolicyDecision {
  if (!Object.hasOwn(PRESETS, preset)) {
    return { kind: 'deny', reason: 'unknown preset: ' + String(preset) }
  }
  const unknown = needs.filter((need) => !KNOWN_CAPABILITIES.includes(need))
  if (unknown.length > 0)
    return { kind: 'deny', reason: 'unknown capability: ' + unknown.join(', ') }
  const missing = needs.filter((need) => !allows(preset, need))
  if (missing.length === 0) return { kind: 'allow' }
  return { kind: 'ask', reason: 'preset ' + preset + ' does not allow: ' + missing.join(', ') }
}
