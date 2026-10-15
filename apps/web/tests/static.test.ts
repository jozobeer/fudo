import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { staticPath, staticResponse } from '../src/server/index.ts'

describe('static files', () => {
  test('the root and plain names stay inside the root', () => {
    expect(staticPath('/srv/app', '/')).toBe('/srv/app/index.html')
    expect(staticPath('/srv/app', '/main.js')).toBe('/srv/app/main.js')
    expect(staticPath('/srv/app', '/assets/app.css')).toBe('/srv/app/assets/app.css')
  })

  test('paths that climb out are refused, encoded or not', () => {
    expect(staticPath('/srv/app', '/../secret')).toBeUndefined()
    expect(staticPath('/srv/app', '/%2e%2e/secret')).toBeUndefined()
    expect(staticPath('/srv/app', '/a/../../secret')).toBeUndefined()
    expect(staticPath('/srv/app', '/%zz')).toBeUndefined()
    expect(staticPath('/srv/app', '/bad\u0000name')).toBeUndefined()
  })

  test('a present file answers with its type and a missing one does not answer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-static-'))
    await Bun.write(join(root, 'index.html'), '<h1>jozo-harness</h1>')
    const found = await staticResponse(root, '/')
    expect(found?.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await found?.text()).toBe('<h1>jozo-harness</h1>')
    expect(await staticResponse(root, '/missing.js')).toBeUndefined()
    await rm(root, { recursive: true, force: true })
  })
})
