import { homedir } from 'node:os'
import { join } from 'node:path'

/** The one file each session directory holds. */
export const SESSION_FILE_NAME = 'session.v1.jsonl'

/** `~` and `~/x` become the home directory; anything else is left as it is. */
export const expandHome = (root: string): string => {
  if (root === '~') return homedir()
  return root.startsWith('~/') ? join(homedir(), root.slice(2)) : root
}
