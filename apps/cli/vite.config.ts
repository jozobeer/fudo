import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

/** One bundled profile, as the SEA build embeds it and the loader reads it. */
const profile = (name: string): string =>
  fileURLToPath(new URL('../../packages/bundle/base/profiles/' + name + '.yml', import.meta.url))

// The single binary: one ESM bundle for Node with the profiles as SEA assets,
// so `jzh --dump-config` reads them out of the executable.
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
        },
      },
    },
  },
})
