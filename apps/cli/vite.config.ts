import { readdirSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

/** One bundled profile, as the SEA build embeds it and the loader reads it. */
const profile = (name: string): string =>
  fileURLToPath(new URL('../../packages/bundle/base/profiles/' + name + '.yml', import.meta.url))

/**
 * The built browser app, when there is one. `pnpm run build:web` writes it, and
 * a binary built after that serves the page without the tree around it.
 */
const pageAssets = (): Record<string, string> => {
  const directory = fileURLToPath(new URL('../../apps/web/dist/', import.meta.url))
  const assets: Record<string, string> = {}
  const walk = (from: string, prefix: string): void => {
    let entries: Array<Dirent>
    try {
      entries = readdirSync(from, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(from, entry.name)
      if (entry.isDirectory()) walk(path, prefix + entry.name + '/')
      else assets['web/' + prefix + entry.name] = path
    }
  }
  walk(directory, '')
  return assets
}

// The single binary: one ESM bundle for Node with the profiles and (when built)
// the page as SEA assets, so the executable reads both out of itself.
export default defineConfig({
  pack: {
    entry: ['src/run.ts'],
    format: 'esm',
    platform: 'node',
    dts: false,
    deps: { alwaysBundle: [/.*/] },
    exe: {
      fileName: 'jzh',
      outDir: 'dist',
      seaConfig: {
        assets: {
          'profiles/base.yml': profile('base'),
          'profiles/headless.yml': profile('headless'),
          'profiles/repl.yml': profile('repl'),
          ...pageAssets(),
        },
      },
    },
  },
})
