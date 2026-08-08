import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const backgroundScript = await readFile(new URL('../background.js', import.meta.url), 'utf8');

function runBackground(initialStats = {}) {
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
});
