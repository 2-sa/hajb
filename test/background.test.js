import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const backgroundScript = await readFile(new URL('../background.js', import.meta.url), 'utf8');

function runBackground(initialStats = {}, { failWrites = 0 } = {}) {
  let actionStats = initialStats;
  let messageListener;
  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    },
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, actionStats };
        },
        async set(values) {
          if (failWrites-- > 0) throw new Error('Storage unavailable');
          actionStats = values.actionStats;
        }
      }
    }
  };

  vm.runInNewContext(backgroundScript, { chrome });
  return {
    getStats: () => actionStats,
    send(message) {
      return new Promise((resolve) => {
        const keepChannelOpen = messageListener(message, {}, resolve);
        assert.equal(keepChannelOpen, true);
      });
    },
    sendInvalid(message) {
      return messageListener(message, {}, () => {});
    }
  };
}

test('serializes action counter writes so concurrent events are not lost', async () => {
  const background = runBackground({ block: 4, mute: 2, notInterested: 8 });

  const [first, second] = await Promise.all([
    background.send({ type: 'HAJB_RECORD_ACTION', actionType: 'notInterested' }),
    background.send({ type: 'HAJB_RECORD_ACTION', actionType: 'notInterested' })
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(JSON.stringify(background.getStats()), JSON.stringify({ block: 4, mute: 2, notInterested: 10 }));
});

test('ignores unknown messages and action types', () => {
  const background = runBackground();
  assert.equal(background.sendInvalid({ type: 'OTHER' }), false);
  assert.equal(background.sendInvalid({ type: 'HAJB_RECORD_ACTION', actionType: 'report' }), false);
  assert.equal(background.sendInvalid({ type: 'HAJB_RECORD_ACTION', actionType: 'toString' }), false);
});

test('recovers queued writes after a storage failure', async () => {
  const background = runBackground({ block: 4 }, { failWrites: 1 });
  const [failed, recovered] = await Promise.all([
    background.send({ type: 'HAJB_RECORD_ACTION', actionType: 'block' }),
    background.send({ type: 'HAJB_RECORD_ACTION', actionType: 'mute' })
  ]);
  assert.equal(failed.ok, false);
  assert.equal(recovered.ok, true);
  assert.equal(background.getStats().block, 4);
  assert.equal(background.getStats().mute, 1);
});

test('orders resets between concurrent action updates', async () => {
  const background = runBackground({ block: 10, mute: 2 });
  const results = await Promise.all([
    background.send({ type: 'HAJB_RECORD_ACTION', actionType: 'block' }),
    background.send({ type: 'HAJB_RESET_STATS' }),
    background.send({ type: 'HAJB_RECORD_ACTION', actionType: 'mute' })
  ]);
  assert.ok(results.every((result) => result.ok));
  assert.equal(JSON.stringify(background.getStats()), JSON.stringify({ block: 0, mute: 1, notInterested: 0 }));
});
