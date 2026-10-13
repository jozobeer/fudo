import type { Waterfall, Serial, Emit } from '@fudo/kernel'
import type { Effect } from 'effect'
import type { LlmFailure, TimedStreamChunk, RequestMessage, ToolSchema } from '@fudo/llm'
import type { Agent, UserMessage } from '@fudo/agent'

export interface PreStepInput {
  readonly agent: Agent
  readonly messages: ReadonlyArray<UserMessage>
}

export type PreStepDecision =
  | { readonly kind: 'enter' }
  | { readonly kind: 'reject'; readonly reason: string }

/** The request as the loop will send it, after every adjustment. */
export interface AgentRequest {
  readonly provider: string
  readonly model: string
  readonly params: Readonly<Record<string, unknown>>
  readonly messages: ReadonlyArray<RequestMessage>
  readonly tools: ReadonlyArray<ToolSchema>
}

export type RequestErrorDecision = { readonly kind: 'retry' } | { readonly kind: 'fail' }

declare module '@fudo/kernel/hook' {
  interface HookMap {
    'agent/pre-step': Waterfall<(input: PreStepInput) => Effect.Effect<PreStepDecision>>
    'agent/request': Waterfall<(request: AgentRequest) => Effect.Effect<AgentRequest>>
    'agent/request-error': Waterfall<(failure: LlmFailure) => Effect.Effect<RequestErrorDecision>>
    'agent/assistant-stream': Emit<(chunk: TimedStreamChunk) => void>
    'agent/turn-stopping': Serial<(agent: Agent) => Effect.Effect<void>>
  }
}
