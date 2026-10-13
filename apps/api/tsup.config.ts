import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Inline the workspace package (it ships TypeScript source); keep real deps external.
  noExternal: ['@iitd-bus/shared'],
});
