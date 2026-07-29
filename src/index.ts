import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { zipSync, type Zippable } from 'fflate';
import type { ConfigEnv, Plugin, UserConfig } from 'vite';
import { manifestSchema } from './manifest-schema.js';

const FIXED_MTIME = new Date('1980-01-01T00:00:00.000Z');
const require = createRequire(import.meta.url);

interface ManifestValidator {
  (value: unknown): boolean;
  errors?: unknown;
}

interface AjvInstance {
  compile(schema: object): ManifestValidator;
}

type AjvConstructor = new (options: { allErrors: boolean }) => AjvInstance;

const ajvModule = require('ajv/dist/2020.js') as AjvConstructor & { default?: AjvConstructor };
const Ajv2020 = ajvModule.default ?? ajvModule;

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

interface CargoTarget {
  name: string;
  crate_types: string[];
}

interface CargoPackage {
  manifest_path: string;
  targets: CargoTarget[];
}

interface CargoMetadata {
  packages: CargoPackage[];
  target_directory: string;
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: 'inherit' });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function cargoMetadata(cratePath: string, root: string): Promise<CargoMetadata> {
  const command = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const output: Buffer[] = [];
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(
      command,
      ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', cratePath],
      { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`cargo metadata exited with code ${code}`));
    });
  });
  return JSON.parse(Buffer.concat(output).toString('utf8')) as CargoMetadata;
}

async function collectFiles(root: string): Promise<Zippable> {
  const files: Zippable = {};
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const key = relative(root, path).split(sep).join('/');
        files[key] = [new Uint8Array(await readFile(path)), { mtime: FIXED_MTIME }];
      }
    }
  };
  await visit(root);
  return files;
}

function safeProjectPath(root: string, candidate: string, label: string): string {
  const resolved = resolve(root, candidate);
  const relativePath = relative(root, resolved);
  if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`${label} must stay inside the plugin project`);
  }
  return resolved;
}

export async function validateManifest(path: string): Promise<PluginManifest> {
  const manifest: unknown = JSON.parse(await readFile(path, 'utf8'));
  const validate = new Ajv2020({ allErrors: true }).compile(manifestSchema);
  if (!validate(manifest)) {
    throw new Error(`Invalid YRChat plugin manifest: ${JSON.stringify(validate.errors)}`);
  }
  return manifest as PluginManifest;
}

export default function yrchatPlugin(options: YrchatPluginOptions = {}): Plugin {
  let root = process.cwd();
  let command: ConfigEnv['command'] = 'serve';
  const buildDirectoryName = options.buildDir ?? '.yrplugin-build';
  return {
    name: 'yrchat-plugin',
    enforce: 'pre',
    async config(config: UserConfig, environment: ConfigEnv) {
      root = resolve(config.root ?? process.cwd());
      command = environment.command;
      const manifestPath = safeProjectPath(root, options.manifest ?? 'manifest.json', 'manifest');
      await validateManifest(manifestPath);
      if (command !== 'build') return undefined;
      const buildRoot = safeProjectPath(root, buildDirectoryName, 'buildDir');
      return { build: { outDir: join(buildRoot, 'ui'), emptyOutDir: true } };
    },
    async closeBundle() {
      if (command !== 'build') return;
      const manifestPath = safeProjectPath(root, options.manifest ?? 'manifest.json', 'manifest');
      const cratePath = safeProjectPath(root, options.crate ?? 'src-plugin/Cargo.toml', 'crate');
      const buildRoot = safeProjectPath(root, buildDirectoryName, 'buildDir');
      const outputRoot = safeProjectPath(root, options.outputDir ?? 'dist', 'outputDir');
      const manifest = await validateManifest(manifestPath);
      const metadata = await cargoMetadata(cratePath, root);
      const cratePackage = metadata.packages.find(
        (item) => resolve(item.manifest_path) === resolve(cratePath),
      );
      if (!cratePackage) throw new Error(`Cargo package not found for ${cratePath}`);
      const cdylib = cratePackage.targets.find((target) => target.crate_types.includes('cdylib'));
      if (!cdylib) throw new Error('Plugin crate must expose a cdylib target');
      const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
      await run(
        cargo,
        ['build', '--manifest-path', cratePath, '--target', 'wasm32-unknown-unknown', '--release'],
        root,
      );
      const wasmName = `${cdylib.name.replaceAll('-', '_')}.wasm`;
      const wasmPath = join(metadata.target_directory, 'wasm32-unknown-unknown', 'release', wasmName);
      const wasm = await readFile(wasmPath);
      const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(
        (item) => item.name,
      );
      for (const required of ['memory', 'alloc', 'dealloc', 'plugin_handle']) {
        if (!exports.includes(required)) throw new Error(`Plugin WASM does not export ${required}`);
      }
      await mkdir(buildRoot, { recursive: true });
      await cp(manifestPath, join(buildRoot, 'manifest.json'));
      await writeFile(join(buildRoot, manifest.entry), wasm);
      await mkdir(outputRoot, { recursive: true });
      const output = join(outputRoot, `${manifest.id}-${manifest.version}.yrplugin`);
      await writeFile(output, zipSync(await collectFiles(buildRoot), { level: 9 }));
      console.info(`Created ${output}`);
    },
  };
}

export { manifestSchema } from './manifest-schema.js';
