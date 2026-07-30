import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/manifest-schema.ts'],
  format: 'esm',
  dts: true,
  minify: true,
  sourcemap: true,
  clean: true,
  platform: 'node',
  target: 'node18',
  external: ['vite'],
});
