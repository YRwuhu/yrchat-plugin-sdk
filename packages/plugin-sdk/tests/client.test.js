import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginClient } from '../dist/index.js';

test('uses the preview adapter outside YRChat', async () => {
  const calls = [];
  const client = createPluginClient('dev.yrchat.test', {
    fallback: {
      async invoke(operation, payload) {
        calls.push({ operation, payload });
        return { ok: true };
      },
      async close() {
        calls.push({ operation: 'close' });
      },
    },
  });

  assert.deepEqual(await client.invoke('start', { round: 1 }), { ok: true });
  await client.close();
  assert.deepEqual(calls, [
    { operation: 'start', payload: { round: 1 } },
    { operation: 'close' },
  ]);
});

test('rejects invalid identifiers and empty operations', async () => {
  assert.throws(() => createPluginClient('../other-plugin'), /Invalid YRChat plugin ID/);
  const client = createPluginClient('dev.yrchat.test', {
    fallback: { async invoke() {}, async close() {} },
  });
  await assert.rejects(client.invoke('  '), /must not be empty/);
});

test('fails clearly when no host or preview adapter exists', async () => {
  const client = createPluginClient('dev.yrchat.test');
  await assert.rejects(client.invoke('start'), /host is unavailable/);
  await assert.rejects(client.close(), /host is unavailable/);
});
