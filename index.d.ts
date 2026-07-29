import type { Plugin } from 'vite';

export interface YrchatPluginOptions {
  manifest?: string;
  crate?: string;
  outputDir?: string;
  buildDir?: string;
}

export default function yrchatPlugin(options?: YrchatPluginOptions): Plugin;
export { manifestSchema } from './manifest-schema.js';
