import { describe, expect, test } from 'vitest'
import { noneSandbox } from '@jozo-harness/safety'
import { toolDeclaration, toolSchemaIssues } from '@jozo-harness/tools'
import { tier0Tools } from '../src/index.ts'

describe('tier 0 tool schemas', () => {
  test('every tool says what it is for and what each parameter means', () => {
    const issues = tier0Tools(noneSandbox).flatMap((tool) =>
      toolSchemaIssues(toolDeclaration(tool)),
    )

    expect(issues).toEqual([])
  })
})
