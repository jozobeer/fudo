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
  test: {
    // The workspace's own tests, wherever a package keeps them. The built
    // browser app and scratch trees hold none.
    include: [
      'apps/*/tests/**/*.test.ts',
      'packages/*/*/tests/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    coverage: { provider: 'v8' },
  },
  run: {
    tasks: {
      // cargo owns crates/; pnpm is told to leave the directory alone by
      // pnpm-workspace.yaml. Cargo has its own cache, so Vite Task keeps out.
      'rust:check': { command: 'cargo check --workspace', cache: false },
    },
  },
})
