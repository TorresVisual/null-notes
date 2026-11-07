import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    testTimeout: 15000,
    // ReviewSession tests flake under a loaded runner; see the follow-up issue.
    retry: process.env.CI ? 2 : 0,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})
