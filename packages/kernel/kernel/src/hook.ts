import type { Effect, Scope } from 'effect'

/** Dispatch modes of a hook, mirroring the Cordis event modes that dsh uses. */
export type HookKind = 'emit' | 'serial' | 'parallel' | 'bail' | 'waterfall'

declare const HookKindBrand: unique symbol

/** A hook declaration. Packages extend `HookMap` by declaration merging. */
export interface Hook<out Kind extends HookKind, Function> {
  readonly [HookKindBrand]: readonly [Kind, Function]
}

/** Calls every listener for its side effect. A throwing listener is isolated. */
export type Emit<F extends (...args: any[]) => void> = Hook<'emit', F>

/** Runs listeners in order, awaiting each. Stops at the first failure. */
export type Serial<F extends (...args: any[]) => Effect.Effect<any, any, any>> = Hook<'serial', F>

/** Runs every listener concurrently and awaits all of them. */
export type Parallel<F extends (...args: any[]) => Effect.Effect<any, any, any>> = Hook<
  'parallel',
  F
>

/** Runs listeners in order and stops at the first listener that answers. */
export type Bail<F extends (...args: any[]) => Effect.Effect<unknown, any, any>> = Hook<'bail', F>

/** Runs listeners in order, passing the next listener as the `next` argument. */
export type Waterfall<F extends (...args: any[]) => Effect.Effect<any, any, any>> = Hook<
  'waterfall',
  F
>

/** Hooks known to the kernel. Packages add their own by declaration merging. */
export interface HookMap {}

export type HookName = keyof HookMap

type HookFunction<H> =
  H extends Hook<HookKind, infer F> ? (F extends (...args: any[]) => any ? F : never) : never

export type HookArgs<H> = Parameters<HookFunction<H>>
export type HookValue<H> =
  ReturnType<HookFunction<H>> extends Effect.Effect<infer A, any, any> ? A : void
export type HookError<H> =
  ReturnType<HookFunction<H>> extends Effect.Effect<any, infer E, any> ? E : never
export type HookServices<H> =
  ReturnType<HookFunction<H>> extends Effect.Effect<any, any, infer R> ? R : never

/** The listener shape a hook accepts. Waterfall listeners receive `next`. */
export type HookListener<H> =
  H extends Hook<'waterfall', infer F>
    ? F extends (...args: infer A) => infer R
      ? (...args: [...A, next: () => R]) => R
      : never
    : HookFunction<H>

export interface OnOptions {
  readonly prepend?: boolean
}

/**
 * Registry of hook listeners. A dispatch function only accepts the hook names
 * whose declared mode matches it.
 */
export interface HookRegistry {
  /** Registers `listener` until the surrounding scope closes. */
  on<K extends HookName>(
    name: K,
    listener: HookListener<HookMap[K]>,
    options?: OnOptions,
  ): Effect.Effect<void, never, Scope.Scope>

  emit<K extends HookName>(name: K, ...args: HookArgs<HookMap[K]>): Effect.Effect<void>

  serial<K extends HookName>(
    name: K,
    ...args: HookArgs<HookMap[K]>
  ): Effect.Effect<void, HookError<HookMap[K]>, HookServices<HookMap[K]>>

  parallel<K extends HookName>(
    name: K,
    ...args: HookArgs<HookMap[K]>
  ): Effect.Effect<void, HookError<HookMap[K]>, HookServices<HookMap[K]>>

  bail<K extends HookName>(
    name: K,
    ...args: HookArgs<HookMap[K]>
  ): Effect.Effect<
    HookValue<HookMap[K]> | undefined,
    HookError<HookMap[K]>,
    HookServices<HookMap[K]>
  >

  waterfall<K extends HookName>(
    name: K,
    ...args: HookArgs<HookMap[K]>
  ): Effect.Effect<
    HookValue<HookMap[K]> | undefined,
    HookError<HookMap[K]>,
    HookServices<HookMap[K]>
  >
}
