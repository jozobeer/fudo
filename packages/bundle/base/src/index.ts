import { readFile } from 'node:fs/promises'

/**
 * The SEA asset store, when the runtime has one. Bun has no `node:sea`, and a
 * runtime without it runs from the tree, where the profiles are files.
 */
const sea = await import('node:sea').catch(() => undefined)

/** The profiles this bundle ships, by the name a caller asks for. */
const NAMES = ['base', 'headless', 'repl'] as const

type BundledName = (typeof NAMES)[number]

/** Where one profile sits: the same path as a file beside this module and as a SEA asset. */
const assetOf = (name: BundledName): string => 'profiles/' + name + '.yml'

const isBundledName = (name: string): name is BundledName =>
  (NAMES as ReadonlyArray<string>).includes(name)

/**
 * One profile's text. A compiled binary carries the files as SEA assets; a run
 * from the tree reads them from disk. Nothing is read twice.
 */
const readProfile = async (name: BundledName): Promise<string> => {
  const asset = assetOf(name)
  if (sea !== undefined && sea.isSea()) return sea.getAsset(asset, 'utf8')
  return readFile(new URL('../' + asset, import.meta.url), 'utf8')
}

const cache = new Map<BundledName, string>()

/** Profile shipped with the default bundle. Rows are resolved by the kernel loader. */
export async function loadBundledProfile(): Promise<string> {
  return loadBundledProfileNamed('base')
}

/** Reads the bundled profile named name, e.g. headless or repl; an unknown name rejects. */
export async function loadBundledProfileNamed(name: string): Promise<string> {
  if (!isBundledName(name)) throw new Error('no bundled profile named ' + name)
  const known = cache.get(name)
  if (known !== undefined) return known
  const text = await readProfile(name)
  cache.set(name, text)
  return text
}
