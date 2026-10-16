import { Data } from 'effect'

/** Why a request could not be served. The page shows the message. */
export class WebError extends Data.TaggedError('WebError')<{
  readonly message: string
}> {}
