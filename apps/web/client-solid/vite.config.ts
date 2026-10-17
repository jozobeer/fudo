import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'
import solid from 'vite-plugin-solid'

// The browser app, bundled where `jzh web` reads it: the server root, and the
// `web/` assets a compiled binary carries.
export default defineConfig({
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [solid(), tailwindcss()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx'],
  },
})
