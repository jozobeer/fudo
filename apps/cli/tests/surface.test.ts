import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { FLAG_NAMES } from '../src/args.ts'
import { ConfigFileSchema } from '../src/config-file.ts'
import { SETTINGS_KEYS, renderSurface } from '../src/surface.ts'

describe('the notes the dump prints', () => {
  test('every settings key the schema accepts has a note', () => {
    const document = Schema.toJsonSchemaDocument(ConfigFileSchema)
    const schema = document.schema as { readonly properties?: Readonly<Record<string, unknown>> }
    const keys = Object.keys(schema.properties ?? {})

    expect(SETTINGS_KEYS.map((note) => note.name).sort()).toEqual(keys.sort())
  })

  test('renderSurface tells where the settings live and what else is read', () => {
    const text = renderSurface('/tmp/fudo/config.yaml')

    expect(text).toContain('settings (/tmp/fudo/config.yaml):')
    expect(text).toContain('  - model: ')
    expect(text).toContain('  - plugins: ')
    expect(text).toContain(FLAG_NAMES.join(' '))
    expect(text).toContain('XDG_CONFIG_HOME')
    expect(text).toContain('BRAVE_API_KEY')
    expect(text).toContain('  - planMode ')
  })
})
