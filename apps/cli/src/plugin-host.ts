import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Effect } from 'effect'
import type { PluginRow } from '@fudo/kernel'
import type { AskShape } from '@fudo/safety'
import { ToolError } from '@fudo/tools'
import type { PluginChange, PluginHost, PluginRowSummary } from '@fudo/tools-tier1'
import { parseConfigText } from './config-file.ts'
import { applyEdit, type SettingsEdit } from './settings-edit.ts'

export interface PluginHostOptions {
  /** The rows this run was built from, in the order they were layered. */
  readonly rows: ReadonlyArray<PluginRow>
  /** The plugin names this build can wire. */
  readonly known: ReadonlyArray<string>
  readonly settingsPath: string
  readonly ask: AskShape
}

const summaryOf = (row: PluginRow): PluginRowSummary => ({
  id: row.id,
  name: row.name,
  disabled: row.disabled === true,
})

const editFor = (change: PluginChange): SettingsEdit => {
  if (change.kind === 'add') return { kind: 'add-row', id: change.id, name: change.name }
  if (change.kind === 'remove') return { kind: 'remove-row', id: change.id }
  // set-row writes the override into the settings, even for a row a profile provides.
  return {
    kind: 'set-row',
    id: change.id,
    name: change.name,
    key: 'disabled',
    value: change.disabled ? 'true' : 'false',
  }
}

const failure = (message: string): ToolError => new ToolError({ code: 'execution', message })

/**
 * The plugin rows as the settings file holds them: the tool reads them and writes
 * one change, and the CLI hands the same file to the next start.
 */
export const makePluginHost = (options: PluginHostOptions): PluginHost => ({
  rows: () => options.rows.map(summaryOf),
  known: () => options.known,
  ask: options.ask,
  change: (change) =>
    Effect.gen(function* () {
      const path = options.settingsPath
      const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
      const edited = yield* applyEdit(text, editFor(change)).pipe(
        Effect.mapError((error) =>
          failure('the settings refused the change (' + error.code + '): ' + error.about),
        ),
      )
      if (edited.changed) {
        yield* Effect.try({
          try: () => writeFileSync(path, edited.text),
          catch: () => failure('cannot write the settings: ' + path),
        })
      }
      const parsed = yield* parseConfigText(edited.text).pipe(
        Effect.mapError((error) => failure(error.message)),
      )
      return (parsed.plugins ?? []).map(summaryOf)
    }),
})
