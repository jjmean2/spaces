import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'core/index': 'src/core/index.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  deps: {
    neverBundle: ['react', 'react-dom', /^react\//, /^react-dom\//],
  },
  dts: true,
  clean: true,
})
