import type { Plugin } from 'vite';
export interface YrchatPluginOptions {
    manifest?: string;
    crate?: string;
    outputDir?: string;
    buildDir?: string;
}
interface PluginManifest {
    id: string;
    version: string;
    entry: string;
    api_version: 1 | 2;
}
export declare function validateManifest(path: string): Promise<PluginManifest>;
export default function yrchatPlugin(options?: YrchatPluginOptions): Plugin;
export { manifestSchema } from './manifest-schema.js';
//# sourceMappingURL=index.d.ts.map