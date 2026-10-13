import { Effect } from 'effect'
import type { ApprovalRequested } from './events.ts'

/** Where a prompt writes and where it reads the answer. */
export interface PromptIo {
  readonly write: (text: string) => Effect.Effect<void>
  readonly readLine: () => Effect.Effect<string | undefined>
}

const question = (request: ApprovalRequested): string =>
  'allow ' + request.tool + '? (' + request.reason + ') [y/N] '

const isYes = (line: string | undefined): boolean =>
  (line ?? '').trim().toLowerCase().startsWith('y')

/** Asks on a terminal; anything but an explicit yes denies, including end of input. */
export const promptForApproval =
  (io: PromptIo) =>
  (request: ApprovalRequested): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      yield* io.write(question(request))
      return isYes(yield* io.readLine())
    })
