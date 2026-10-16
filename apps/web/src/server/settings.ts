import type { Effect } from 'effect'
import type { SettingsView } from '../shared/rpc.ts'
import type { WebError } from './errors.ts'

/**
 * The settings of the run behind the page: what is in effect, and the parts a
 * page may change. The view is the wire shape the page reads; a change lands in
 * the settings file, so it takes effect the next time a run reads that file.
 */
export interface SettingsPort {
  readonly read: () => Effect.Effect<SettingsView, WebError>
  /** Every model the provider offers, as provider/model routes. */
  readonly models: () => Effect.Effect<ReadonlyArray<string>, WebError>
  readonly setModel: (model: string) => Effect.Effect<void, WebError>
}
