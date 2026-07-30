import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateManifest } from '../dist/index.js';

const validManifest = {
  id: 'dev.yrchat.test',
  name: 'Test',
  description: '',
  version: '1.0.0',
  api_version: 2,
  entry: 'component.wasm',
  ui: { entry: 'ui/index.html', title: 'Test', width: 800, height: 600, min_width: 320, min_height: 240, resizable: true },
  permissions: { ai_chat: false, ai_vision: false, character_context: false },
};

test('validates API v2 manifests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yrchat-sdk-'));
  const path = join(root, 'manifest.json');
  await writeFile(path, JSON.stringify(validManifest));
  assert.equal((await validateManifest(path)).api_version, 2);
});

test('rejects unsupported API versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yrchat-sdk-'));
  const path = join(root, 'manifest.json');
  await writeFile(path, JSON.stringify({ ...validManifest, api_version: 3 }));
  await assert.rejects(validateManifest(path), /Invalid YRChat plugin manifest/);
});
