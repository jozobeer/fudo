import { Data } from 'effect'
import type { ToolSchema } from '@fudo/llm'

export type PromptErrorCode = 'duplicate-section' | 'multiple-complete' | 'unknown-variable'

/** A failure of prompt registration or assembly. */
export class PromptError extends Data.TaggedError('PromptError')<{
  readonly code: PromptErrorCode
  readonly message: string
}> {}

/** Values a section may interpolate with `{{name}}`. */
export interface AssembleContext {
  readonly variables: Readonly<Record<string, string>>
}

export interface PromptSection {
  readonly name: string
  /** Ascending. Sections with the same order sort by name code-unit. */
  readonly order: number
  readonly text: string | ((context: AssembleContext) => string)
  /** This section alone replaces the whole prompt. */
  readonly complete?: boolean
}

/** One assembled request preamble: the system prompt and the tools the model may call. */
export interface PromptBuild {
  readonly system: string
  readonly tools: ReadonlyArray<ToolSchema>
}
