import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const here = import.meta.dir

await rm(join(here, 'dist'), { recursive: true, force: true })
const built = await Bun.build({
  entrypoints: [join(here, 'client/main.ts')],
  outdir: join(here, 'dist'),
  target: 'browser',
  minify: true,
  naming: 'main.js',
})
if (!built.success) {
  for (const log of built.logs) console.error(log)
  process.exit(1)
}
for (const name of ['index.html', 'style.css']) {
  await Bun.write(join(here, 'dist', name), Bun.file(join(here, 'client', name)))
}
console.log('built apps/web/dist')
