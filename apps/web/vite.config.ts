import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite-plus'

const here = fileURLToPath(new URL('.', import.meta.url))

/**
 * The page and its stylesheet are served under the names they are written with,
 * so they are copied beside the bundle rather than hashed into assets/.
 */
const copyPage = (): Plugin => {
  let outDir = join(here, 'dist')
  return {
    name: 'jozo-harness-copy-page',
    configResolved(config) {
      outDir = config.build.outDir
    },
    async closeBundle() {
      await copyFile(join(here, 'client/index.html'), join(outDir, 'index.html'))
      await copyFile(join(here, 'client/style.css'), join(outDir, 'style.css'))
    },
  }
}

// The browser app: one ESM file the page loads by name, beside the html and css.
export default defineConfig({
  build: {
    outDir: join(here, 'dist'),
    emptyOutDir: true,
    minify: true,
    lib: {
      entry: join(here, 'client/main.ts'),
      formats: ['es'],
      fileName: () => 'main.js',
    },
  },
  plugins: [copyPage()],
})
