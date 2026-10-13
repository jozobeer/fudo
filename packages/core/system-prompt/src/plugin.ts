import type { Plugin } from '@fudo/kernel'
import { Schema } from 'effect'
import { SystemPrompt, systemPromptLayer } from './system-prompt.ts'

/** Loader definition for the prompt section registry. */
export const systemPromptPlugin: Plugin<{}, SystemPrompt, never> = {
  name: '@fudo/system-prompt',
  config: Schema.Struct({}),
  provides: [SystemPrompt],
  requires: [],
  layer: () => systemPromptLayer,
}
