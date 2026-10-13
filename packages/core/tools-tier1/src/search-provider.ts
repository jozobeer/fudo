import { Effect } from 'effect'
import { ToolError } from '@fudo/tools'
import type { SearchHit, SearchHost } from './search.ts'

export interface BraveSearchOptions {
  readonly apiKey: string
  /** Overridable so tests can point at a local server. */
  readonly baseUrl?: string
}

interface BraveResponse {
  readonly web?: {
    readonly results?: ReadonlyArray<{
      readonly title?: string
      readonly url?: string
      readonly description?: string
    }>
  }
}

/** Brave's web search, as the provider the web_search tool calls. */
export const braveSearch = (options: BraveSearchOptions): SearchHost => ({
  search: (query, limit) =>
    Effect.tryPromise({
      try: async () => {
        const base = options.baseUrl ?? 'https://api.search.brave.com/res/v1/web/search'
        const url = base + '?q=' + encodeURIComponent(query) + '&count=' + String(limit)
        const response = await fetch(url, {
          headers: { accept: 'application/json', 'X-Subscription-Token': options.apiKey },
        })
        if (!response.ok) throw new Error('status ' + String(response.status))
        const body = (await response.json()) as BraveResponse
        return (body.web?.results ?? []).map((hit): SearchHit => ({
          title: hit.title ?? '',
          url: hit.url ?? '',
          snippet: hit.description ?? '',
        }))
      },
      catch: () => new ToolError({ code: 'execution', message: 'search failed for: ' + query }),
    }),
})
