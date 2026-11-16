import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { pointer } from './test/pointer-command.ts'

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.tsx'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 1280, height: 800 },
            commands: { pointer },
          },
        },
      },
    ],
  },
})
