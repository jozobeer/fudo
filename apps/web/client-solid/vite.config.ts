import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'
import solid from 'vite-plugin-solid'

// The Solid entry lives beside the current client and is served under /solid/,
// so the default page keeps working while the port is tried out.
export default defineConfig({
  base: '/solid/',
  build: { outDir: '../dist/solid', emptyOutDir: true },
  plugins: [solid(), tailwindcss()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx'],
  },
})
