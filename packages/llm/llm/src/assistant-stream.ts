import type { StreamChunk } from './types.ts'

/** One stream chunk with the time it was received. */
export interface TimedStreamChunk {
  readonly time: number
  readonly chunk: StreamChunk
}

/** One durable record of an assistant stream: a raw chunk or a merged delta run. */
export type AssistantStreamRecord =
  | { readonly type: 'chunk'; readonly time: number; readonly chunk: StreamChunk }
  | {
      readonly type: 'text-chunks'
      readonly time0: number
      readonly index: number
      readonly dt: ReadonlyArray<number>
      readonly texts: ReadonlyArray<string>
    }
  | {
      readonly type: 'reasoning-chunks'
      readonly time0: number
      readonly index: number
      readonly dt: ReadonlyArray<number>
      readonly texts: ReadonlyArray<string>
    }
  | {
      readonly type: 'tool-call-chunks'
      readonly time0: number
      readonly index: number
      readonly dt: ReadonlyArray<number>
      readonly id: string
      readonly name?: string
      readonly args: ReadonlyArray<string>
    }

interface RawRecord {
  readonly type: 'chunk'
  readonly time: number
  readonly chunk: StreamChunk
}

interface DeltaRun {
  readonly type: 'text-chunks' | 'reasoning-chunks'
  readonly time0: number
  readonly index: number
  readonly dt: Array<number>
  readonly texts: Array<string>
  lastTime: number
}

interface ToolRun {
  readonly type: 'tool-call-chunks'
  readonly time0: number
  readonly index: number
  readonly dt: Array<number>
  readonly id: string
  readonly name: string | undefined
  readonly args: Array<string>
  lastTime: number
}

type MutableRecord = RawRecord | DeltaRun | ToolRun

/**
 * Merges consecutive deltas of one block into a single durable record.
 * Times are kept as the first time plus the gaps, so replay sees every delta boundary.
 */
export function compactAssistantStream(
  chunks: Iterable<TimedStreamChunk>,
): ReadonlyArray<AssistantStreamRecord> {
  const records: Array<MutableRecord> = []
  for (const { time, chunk } of chunks) {
    if (continueRun(records[records.length - 1], time, chunk)) continue
    switch (chunk.type) {
      case 'text-delta':
        records.push({
          type: 'text-chunks',
          time0: time,
          index: chunk.index,
          dt: [],
          texts: [chunk.text],
          lastTime: time,
        })
        continue
      case 'reasoning-delta':
        records.push({
          type: 'reasoning-chunks',
          time0: time,
          index: chunk.index,
          dt: [],
          texts: [chunk.text],
          lastTime: time,
        })
        continue
      case 'tool-call-delta':
        records.push({
          type: 'tool-call-chunks',
          time0: time,
          index: chunk.index,
          dt: [],
          id: chunk.id,
          name: chunk.name,
          args: [chunk.argumentsDelta],
          lastTime: time,
        })
        continue
      case 'block-start':
      case 'block-end':
      case 'usage':
      case 'finish':
        records.push({ type: 'chunk', time, chunk })
        continue
    }
    const exhaustive: never = chunk
    throw new Error(`unreachable stream chunk: ${JSON.stringify(exhaustive)}`)
  }
  return records.map(toRecord)
}

/** Expands compact records back into the exact timed chunk sequence. */
export function expandAssistantStream(
  records: ReadonlyArray<AssistantStreamRecord>,
): ReadonlyArray<TimedStreamChunk> {
  const chunks: Array<TimedStreamChunk> = []
  for (const record of records) {
    switch (record.type) {
      case 'chunk':
        chunks.push({ time: record.time, chunk: record.chunk })
        break
      case 'text-chunks':
        emitRun(
          record.texts,
          record.time0,
          record.dt,
          (text) => ({ type: 'text-delta', index: record.index, text }),
          chunks,
        )
        break
      case 'reasoning-chunks':
        emitRun(
          record.texts,
          record.time0,
          record.dt,
          (text) => ({ type: 'reasoning-delta', index: record.index, text }),
          chunks,
        )
        break
      case 'tool-call-chunks':
        emitRun(
          record.args,
          record.time0,
          record.dt,
          (argumentsDelta) => ({
            type: 'tool-call-delta',
            index: record.index,
            id: record.id,
            ...(record.name === undefined ? {} : { name: record.name }),
            argumentsDelta,
          }),
          chunks,
        )
        break
    }
  }
  return chunks
}

type TextDelta = Extract<StreamChunk, { type: 'text-delta' }>
type ReasoningDelta = Extract<StreamChunk, { type: 'reasoning-delta' }>
type ToolCallDelta = Extract<StreamChunk, { type: 'tool-call-delta' }>

const extendText = (
  previous: MutableRecord | undefined,
  chunk: TextDelta,
  time: number,
): boolean => {
  if (previous?.type !== 'text-chunks' || previous.index !== chunk.index) return false
  extend(previous, time, chunk.text)
  return true
}

const extendReasoning = (
  previous: MutableRecord | undefined,
  chunk: ReasoningDelta,
  time: number,
): boolean => {
  if (previous?.type !== 'reasoning-chunks' || previous.index !== chunk.index) return false
  extend(previous, time, chunk.text)
  return true
}

const extendToolCall = (
  previous: MutableRecord | undefined,
  chunk: ToolCallDelta,
  time: number,
): boolean => {
  if (
    previous?.type !== 'tool-call-chunks' ||
    previous.index !== chunk.index ||
    previous.id !== chunk.id ||
    previous.name !== chunk.name
  ) {
    return false
  }
  previous.dt.push(time - previous.lastTime)
  previous.args.push(chunk.argumentsDelta)
  previous.lastTime = time
  return true
}

/** True when the chunk joined the previous record instead of starting a new one. */
const continueRun = (
  previous: MutableRecord | undefined,
  time: number,
  chunk: StreamChunk,
): boolean => {
  if (chunk.type === 'text-delta') return extendText(previous, chunk, time)
  if (chunk.type === 'reasoning-delta') return extendReasoning(previous, chunk, time)
  if (chunk.type === 'tool-call-delta') return extendToolCall(previous, chunk, time)
  return false
}

const extend = (run: DeltaRun, time: number, text: string): void => {
  run.dt.push(time - run.lastTime)
  run.texts.push(text)
  run.lastTime = time
}

const emitRun = (
  members: ReadonlyArray<string>,
  time0: number,
  dt: ReadonlyArray<number>,
  make: (member: string) => StreamChunk,
  out: Array<TimedStreamChunk>,
): void => {
  let time = time0
  for (let index = 0; index < members.length; index += 1) {
    if (index > 0) time += dt[index - 1] ?? 0
    out.push({ time, chunk: make(members[index] ?? '') })
  }
}

const toRecord = (record: MutableRecord): AssistantStreamRecord => {
  switch (record.type) {
    case 'chunk':
      return record
    case 'text-chunks':
    case 'reasoning-chunks':
      return {
        type: record.type,
        time0: record.time0,
        index: record.index,
        dt: record.dt,
        texts: record.texts,
      }
    case 'tool-call-chunks':
      return {
        type: 'tool-call-chunks',
        time0: record.time0,
        index: record.index,
        dt: record.dt,
        id: record.id,
        ...(record.name === undefined ? {} : { name: record.name }),
        args: record.args,
      }
  }
}
