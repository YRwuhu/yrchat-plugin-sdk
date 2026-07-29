import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { zipSync } from 'fflate';
import { manifestSchema } from './manifest-schema.js';

const FIXED_MTIME = new Date('1980-01-01T00:00:00.000Z');

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: 'inherit' });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function cargoMetadata(cratePath, root) {
  const command = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const output = [];
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', cratePath], {
      cwd: root,
      shell: false,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.on('error', rejectPromise);
    child.on('exit', (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`cargo metadata exited with code ${code}`)));
  });
  return JSON.parse(Buffer.concat(output).toString('utf8'));
}

async function collectFiles(root) {
  const files = {};
  const visit = async (directory) => {
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

function safeProjectPath(root, candidate, label) {
  const resolved = resolve(root, candidate);
  const relativePath = relative(root, resolved);
  if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`${label} must stay inside the plugin project`);
  }
  return resolved;
}

export async function validateManifest(path) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  const validate = new Ajv2020({ allErrors: true }).compile(manifestSchema);
  if (!validate(manifest)) {
    throw new Error(`Invalid YRChat plugin manifest: ${JSON.stringify(validate.errors)}`);
  }
  return manifest;
}

export default function yrchatPlugin(options = {}) {
  let root = process.cwd();
  let command = 'serve';
  const buildDirectoryName = options.buildDir ?? '.yrplugin-build';
  return {
    name: 'yrchat-plugin',
    enforce: 'pre',
    async config(config, environment) {
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
      const cratePackage = metadata.packages.find((item) => resolve(item.manifest_path) === resolve(cratePath));
      if (!cratePackage) throw new Error(`Cargo package not found for ${cratePath}`);
      const cdylib = cratePackage.targets.find((target) => target.crate_types.includes('cdylib'));
      if (!cdylib) throw new Error('Plugin crate must expose a cdylib target');
      const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
      await run(cargo, ['build', '--manifest-path', cratePath, '--target', 'wasm32-unknown-unknown', '--release'], root);
      const wasmName = `${cdylib.name.replaceAll('-', '_')}.wasm`;
      const wasmPath = join(metadata.target_directory, 'wasm32-unknown-unknown', 'release', wasmName);
      const wasm = await readFile(wasmPath);
      const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map((item) => item.name);
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
