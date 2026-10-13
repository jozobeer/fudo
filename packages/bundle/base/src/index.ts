/** Profile shipped with the default bundle. Rows are resolved by the kernel loader. */
export const baseProfileUrl = new URL('../profiles/base.yml', import.meta.url)

export async function loadBundledProfile(url: URL = baseProfileUrl): Promise<string> {
  return Bun.file(url).text()
}

/** The bundled profile for one CLI profile name, e.g. headless or repl. */
export function bundledProfileUrl(name: string): URL {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('invalid profile name: ' + name)
  return new URL('../profiles/' + name + '.yml', import.meta.url)
}

/** Reads the bundled profile named name; a missing file rejects. */
export async function loadBundledProfileNamed(name: string): Promise<string> {
  return Bun.file(bundledProfileUrl(name)).text()
}
