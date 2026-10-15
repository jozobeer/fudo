import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const entry = join(import.meta.dir, '../src/run.ts')

describe('the tui through a real process', () => {
  test('--tui paints the screen and ctrl-d restores the terminal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jozo-harness-tui-process-'))
    const patch = join(dir, 'sessions.yml')
    await Bun.write(
      patch,
      [
        'name: sessions',
        'plugins:',
        '  - id: session-jsonl',
        "    name: '@jozo-harness/session-jsonl'",
        '    config:',
        '      root: ' + join(dir, 'sessions'),
      ].join('\n'),
    )
    const child = Bun.spawn(
      [process.execPath, 'run', entry, '--tui', '--model', 'stub/model', '--patch', patch],
      {
        cwd: dir,
        env: { ...process.env, XDG_CONFIG_HOME: dir },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    child.stdin.write('\u0004')
    child.stdin.end()
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect(code).toBe(0)
    expect(err).toBe('')
    expect(out).toContain('\u001b[?1049h')
    expect(out).toContain('jozo-harness · stub/model')
    expect(out).toContain('\u001b[?1049l')
    await rm(dir, { recursive: true, force: true })
  })
})
