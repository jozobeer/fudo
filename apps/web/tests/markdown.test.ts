import { describe, expect, test } from 'vitest'
import { renderMarkdown } from '../src/ui/markdown.ts'

describe('the markdown renderer', () => {
  test('text that looks like markup stays text', () => {
    const view = renderMarkdown('<script>alert(1)</scr' + 'ipt>')
    expect(view).not.toContain('<script')
    expect(view).toContain('&lt;script&gt;')
  })

  test('a fenced block keeps its body and names its language', () => {
    const view = renderMarkdown('before\n\n```ts\nconst a = 1 < 2\n```\n\nafter')
    expect(view).toBe(
      '<p>before</p>' +
        '<pre class="code" data-lang="ts"><code>const a = 1 &lt; 2</code></pre>' +
        '<p>after</p>',
    )
  })

  test('a fence that never closes still renders as code', () => {
    const view = renderMarkdown('```\nno end')
    expect(view).toBe('<pre class="code"><code>no end</code></pre>')
  })

  test('headings, lists, quotes and rules take their block shape', () => {
    const view = renderMarkdown('# Title\n\n- one\n- two\n\n1. first\n\n> note\n\n---')
    expect(view).toBe(
      '<h1>Title</h1>' +
        '<ul><li>one</li><li>two</li></ul>' +
        '<ol><li>first</li></ol>' +
        '<blockquote>note</blockquote>' +
        '<hr>',
    )
  })

  test('inline code, emphasis and links are marked up once', () => {
    const view = renderMarkdown('use `pnpm **now**` and **bold** plus [docs](https://e.x/a)')
    expect(view).toBe(
      '<p>use <code>pnpm **now**</code> and <strong>bold</strong> plus ' +
        '<a href="https://e.x/a" target="_blank" rel="noreferrer noopener">docs</a></p>',
    )
  })

  test('a link the browser may not follow stays text', () => {
    const view = renderMarkdown('[x](javascript:alert(1))')
    expect(view).not.toContain('<a ')
    expect(view).toContain('[x](javascript:alert(1))')
  })

  test('a single newline inside a paragraph is a line break', () => {
    expect(renderMarkdown('one\ntwo')).toBe('<p>one<br>two</p>')
  })
})
