/** Row keys the command reads from a row's config itself; no plugin declares them. */
export const MODEL_KEY = 'model'
export const SPILL_BYTES_KEY = 'maxSpillBytes'
export const PLAN_MODE_KEY = 'planMode'

interface RowKeyNote {
  readonly name: string
  readonly where: string
  readonly summary: string
}

export const ROW_KEYS: ReadonlyArray<RowKeyNote> = [
  {
    name: MODEL_KEY,
    where: 'any row',
    summary: 'the route to use when --model and the settings file set none',
  },
  {
    name: SPILL_BYTES_KEY,
    where: 'any row',
    summary: 'tool output above this many bytes goes to a file',
  },
  {
    name: PLAN_MODE_KEY,
    where: 'the @fudo/safety row',
    summary: 'true hides the tools that change the workspace',
  },
]

/** The last block of `--dump-config`: the keys no plugin schema declares. */
export const renderRowKeys = (): string =>
  [
    'row keys the command reads itself (no plugin declares these):',
    ...ROW_KEYS.map((key) => '  - ' + key.name + ' (' + key.where + '): ' + key.summary),
  ].join('\n') + '\n'
