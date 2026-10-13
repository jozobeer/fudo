import base from '../profiles/base.yml' with { type: 'text' }
import headless from '../profiles/headless.yml' with { type: 'text' }
import repl from '../profiles/repl.yml' with { type: 'text' }

// Imported as text, not read by path, so `bun build --compile` embeds them in the binary.
const profiles: ReadonlyMap<string, string> = new Map([
  ['base', base],
  ['headless', headless],
  ['repl', repl],
])

/** Profile shipped with the default bundle. Rows are resolved by the kernel loader. */
export async function loadBundledProfile(): Promise<string> {
  return loadBundledProfileNamed('base')
}

/** Reads the bundled profile named name, e.g. headless or repl; an unknown name rejects. */
export async function loadBundledProfileNamed(name: string): Promise<string> {
  const text = profiles.get(name)
  if (text === undefined) throw new Error('no bundled profile named ' + name)
  return text
}
