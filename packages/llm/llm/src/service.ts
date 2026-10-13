import { Context, type Stream } from 'effect'
import type { LlmAdapter, LlmCapabilities, LlmFailure, LlmRequest, StreamChunk } from './types.ts'

/** The model adapter seam. `llm-openai` provides it; the agent loop consumes it. */
export class Llm extends Context.Service<Llm, LlmAdapter>()('fudo/Llm') {}

void (null as unknown as [
  Stream.Stream<unknown>,
  LlmCapabilities,
  LlmFailure,
  LlmRequest,
  StreamChunk,
])
