import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  minify: true,
  sourcemap: true,
  clean: true,
  platform: 'browser',
  target: 'es2020',
  external: ['@tauri-apps/api/core'],
});
