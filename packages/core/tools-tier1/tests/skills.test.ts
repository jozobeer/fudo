import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverSkills, parseSkillDocument, renderSkillCatalog, skillRoots } from '../src/index.ts'
/** Writes a file, making the directories above it, the way Bun.write did. */
const writeFileDeep = async (path: string, text: string | Uint8Array): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

const skillText = (name: string, body = 'Steps here.'): string =>
  '---\nname: ' + name + '\ndescription: ' + name + ' does things\n---\n\n' + body + '\n'

const writeSkill = async (root: string, name: string, body?: string): Promise<void> => {
  await writeFileDeep(join(root, name, 'SKILL.md'), skillText(name, body))
}

describe('parseSkillDocument', () => {
  test('reads the name, description, and body out of the frontmatter', () => {
    const parsed = parseSkillDocument(
      '---\nname: demo\ndescription: Does one thing\n---\n\nSteps here.\n',
    )

    expect(parsed).toEqual({ name: 'demo', description: 'Does one thing', body: 'Steps here.' })
  })

  test('a file without frontmatter is not a skill document', () => {
    expect(parseSkillDocument('# demo\nsteps\n')).toBeUndefined()
  })

  test('frontmatter without a description is not a skill document', () => {
    expect(parseSkillDocument('---\nname: demo\n---\nbody\n')).toBeUndefined()
  })

  test('a name that could escape a root is not a skill document', () => {
    expect(
      parseSkillDocument('---\nname: ../secrets\ndescription: no\n---\nbody\n'),
    ).toBeUndefined()
  })

  test('quoted values are unquoted and other keys are ignored', () => {
    const parsed = parseSkillDocument(
      '---\nname: "demo"\nlicense: MIT\ndescription: \'Does one thing\'\n---\nbody\n',
    )

    expect(parsed?.name).toBe('demo')
    expect(parsed?.description).toBe('Does one thing')
  })
})

describe('discoverSkills', () => {
  test('lists every root in order, first root wins on one name', async () => {
    const first = await mkdtemp(join(tmpdir(), 'jozo-harness-skills-'))
    const second = await mkdtemp(join(tmpdir(), 'jozo-harness-skills-'))
    await writeSkill(first, 'demo', 'from the first root')
    await writeSkill(first, 'other')
    await writeSkill(second, 'demo', 'from the second root')
    await writeFileDeep(join(second, 'SKILL.md'), 'a stray file, not a skill directory')
    await writeFileDeep(join(first, 'not-a-skill', 'README.md'), 'no SKILL.md here')

    const skills = await Effect.runPromise(discoverSkills([first, second, join(first, 'missing')]))

    expect(skills.map((skill) => skill.name)).toEqual(['demo', 'other'])
    expect(skills[0]?.path).toBe(join(first, 'demo', 'SKILL.md'))
    expect(skills[0]?.description).toBe('demo does things')
    await rm(first, { recursive: true, force: true })
    await rm(second, { recursive: true, force: true })
  })

  test('a SKILL.md that fails validation is ignored', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jozo-harness-skills-'))
    await writeFileDeep(join(root, 'broken', 'SKILL.md'), '# no frontmatter\n')

    const skills = await Effect.runPromise(discoverSkills([root]))

    expect(skills).toEqual([])
    await rm(root, { recursive: true, force: true })
  })
})

describe('renderSkillCatalog', () => {
  test('lists every skill with its description and the reading instruction', () => {
    const text = renderSkillCatalog([
      { name: 'demo', description: 'Does one thing', path: '/skills/demo/SKILL.md' },
      { name: 'other', description: 'Does another', path: '/skills/other/SKILL.md' },
    ])

    expect(text).toContain('<available_skills>')
    expect(text).toContain('- demo: Does one thing')
    expect(text).toContain('- other: Does another')
    expect(text).toContain('call the `skill` tool with the exact skill name')
  })

  test('a description stays on one line and stays short', () => {
    const text = renderSkillCatalog([
      { name: 'demo', description: 'first line\nsecond line ' + 'x'.repeat(400), path: '/s' },
    ])

    const line = text.split('\n').find((candidate) => candidate.startsWith('- demo: ')) ?? ''
    expect(line).not.toContain('\n')
    expect(line.length).toBeLessThanOrEqual(200)
  })

  test('no skills means nothing to publish', () => {
    expect(renderSkillCatalog([])).toBe('')
  })
})

describe('skillRoots', () => {
  test('reads the workspace, the custom roots, then the home', () => {
    expect(skillRoots({ cwd: '/work', home: '/home/me/.jzh', custom: ['/extra'] })).toEqual([
      '/work/.jzh/skills',
      '/extra',
      '/home/me/.jzh/skills',
    ])
  })

  test('a repeated root appears once', () => {
    expect(skillRoots({ cwd: '/work', custom: ['/work/.jzh/skills', '/extra', '/extra'] })).toEqual(
      ['/work/.jzh/skills', '/extra'],
    )
  })

  test('without a home only the workspace and the custom roots remain', () => {
    expect(skillRoots({ cwd: '/work' })).toEqual(['/work/.jzh/skills'])
  })
})
