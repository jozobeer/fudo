import { describe, expect, test } from 'bun:test'
import { toolSchemaIssues } from '../src/index.ts'

const LONG = 'A tool description that is long enough to explain what the tool is for.'

describe('toolSchemaIssues', () => {
  test('accepts a tool whose parameters all carry a meaning', () => {
    const issues = toolSchemaIssues({
      name: 'tool',
      description: LONG,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Where to look.' },
          mode: { type: 'string', description: 'How to look.' },
        },
      },
    })

    expect(issues).toEqual([])
  })

  test('names a nested parameter that has no description of its own', () => {
    const issues = toolSchemaIssues({
      name: 'tool',
      description: LONG,
      parameters: {
        type: 'object',
        properties: {
          weekly: {
            type: 'object',
            description: 'Repeat on these days.',
            properties: {
              weekdays: { type: 'array', description: 'The days.' },
              time: { type: 'string' },
            },
          },
        },
      },
    })

    expect(issues).toEqual(['tool.weekly.time: the parameter has no description'])
  })

  test('names a parameter of an array item object', () => {
    const issues = toolSchemaIssues({
      name: 'tool',
      description: LONG,
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The steps.',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'The step.' },
                status: { type: 'string' },
              },
            },
          },
        },
      },
    })

    expect(issues).toEqual(['tool.todos[].status: the parameter has no description'])
  })
})
