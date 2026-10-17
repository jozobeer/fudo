import { describe, expect, test } from 'vitest'
import { THEMES, themeAttribute, themeFrom } from '../client/theme.ts'

describe('the theme a page reads', () => {
  test('a choice the reader made is kept', () => {
    expect(themeFrom('light')).toBe('light')
    expect(themeFrom('dark')).toBe('dark')
  })

  test('a first visit and a key nobody wrote both follow the system', () => {
    expect(themeFrom(null)).toBe('system')
    expect(themeFrom('solarized')).toBe('system')
  })

  test('the system choice leaves the attribute off, so the stylesheet follows the machine', () => {
    expect(themeAttribute('system')).toBeUndefined()
    expect(themeAttribute('light')).toBe('light')
    expect(themeAttribute('dark')).toBe('dark')
    expect(THEMES).toEqual(['system', 'dark', 'light'])
  })
})
