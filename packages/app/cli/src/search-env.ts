import { braveSearch, type SearchHost } from '@fudo/tools-tier1'

/** The environment variable that turns web search on. */
export const SEARCH_KEY_ENV = 'BRAVE_API_KEY'

/** A search provider when the environment has a key; nothing otherwise. */
export const searchFromEnv = (
  env: Readonly<Record<string, string | undefined>>,
): SearchHost | undefined => {
  const key = env[SEARCH_KEY_ENV]
  if (key === undefined || key === '') return undefined
  return braveSearch({ apiKey: key })
}
