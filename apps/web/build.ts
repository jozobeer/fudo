import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const here = import.meta.dir
/** Where the app is written: the first argument when given, `dist` beside this file otherwise. */
const outdir = resolve(process.argv[2] ?? join(here, 'dist'))

await rm(outdir, { recursive: true, force: true })
const built = await Bun.build({
  entrypoints: [join(here, 'client/main.ts')],
  outdir,
  target: 'browser',
  minify: true,
  naming: 'main.js',
})
if (!built.success) {
  for (const log of built.logs) console.error(log)
  process.exit(1)
}
for (const name of ['index.html', 'style.css']) {
  await Bun.write(join(outdir, name), Bun.file(join(here, 'client', name)))
}
console.log('built ' + outdir)
