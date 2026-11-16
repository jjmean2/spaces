import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve @spaces/layout to its TypeScript source so edits hot-reload without a build.
    conditions: ['@spaces/source'],
  },
})
