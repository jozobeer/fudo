import { defineConfig } from 'vite-plus'

// What .oxlintrc.json and .oxfmtrc.json said, in the place Vite+ reads it. The
// fmt settings are not defaults: every file in this repository is written
// without semicolons and with single quotes.
export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: true,
    ignorePatterns: ['*.md'],
  },
  lint: {
    ignorePatterns: ['apps/web/dist/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  run: {
    tasks: {
      // cargo owns crates/; pnpm is told to leave the directory alone by
      // pnpm-workspace.yaml. Cargo has its own cache, so Vite Task keeps out.
      'rust:check': { command: 'cargo check --workspace', cache: false },
    },
  },
})
