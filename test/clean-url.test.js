import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const script = await readFile(new URL('../content/clean-url.js', import.meta.url), 'utf8');
function setup({ selection = '', activeElement = null, clipboardAvailable = true } = {}) {
  const writes = [];
  const listeners = {};
  const clipboard = clipboardAvailable ? {
    writeText(text) {
      assert.equal(this, clipboard);
      writes.push(text);
      return Promise.resolve();
    }
  } : undefined;
  vm.runInNewContext(script, {
    URL, navigator: { clipboard }, getSelection: () => selection,
    document: { activeElement, addEventListener: (type, callback) => { listeners[type] = callback; } }
  });
  return { clipboard, writes, copy(text = '') {
    let output = text;
    let prevented = false;
    listeners.copy({
      clipboardData: { getData: () => output, setData: (_type, value) => { output = value; } },
      preventDefault: () => { prevented = true; }
    });
    return { output, prevented };
  } };
}

test('cleans X share clipboard writes and preserves the clipboard promise', async () => {
  const { clipboard, writes } = setup();
  const result = clipboard.writeText('https://x.com/RT_com/status/2115682103388160134?a=IFSg4JJx7rPAIubkMF0&s=20&t=abc');
  assert.equal(typeof result.then, 'function');
  await result;
  assert.deepEqual(writes, ['https://x.com/RT_com/status/2115682103388160134']);
});

test('cleans multiple post links while preserving meaningful parameters and other URLs', async () => {
  const { clipboard, writes } = setup();
  await clipboard.writeText('منشور https://twitter.com/alice/status/123?s=20&lang=ar#photo https://mobile.x.com/i/web/status/456?utm_source=share&ref_src=abc https://example.com/alice/status/123?s=20 https://x.com/search?q=test&s=20');
  assert.equal(writes[0], 'منشور https://twitter.com/alice/status/123?lang=ar#photo https://mobile.x.com/i/web/status/456 https://example.com/alice/status/123?s=20 https://x.com/search?q=test&s=20');
});

test('leaves clean links, deceptive hosts and ordinary text unchanged', async () => {
  const { clipboard, writes } = setup();
  const text = 'https://x.com/alice/status/123 https://x.com.evil.test/alice/status/123?s=20 hello';
  await clipboard.writeText(text);
  assert.equal(writes[0], text);
});

test('cleans selection and legacy textarea copying without Clipboard API access', () => {
  assert.deepEqual(setup({ clipboardAvailable: false, selection: 'https://x.com/alice/status/123?s=20' }).copy(), {
    output: 'https://x.com/alice/status/123', prevented: true
  });
  const value = 'https://x.com/alice/status/123?t=abc';
  assert.equal(setup({ activeElement: { tagName: 'TEXTAREA', value, selectionStart: 0, selectionEnd: value.length } }).copy().output,
    'https://x.com/alice/status/123');
});

test('cleans explicit copy data and leaves unrelated copy behavior untouched', () => {
  const page = setup();
  assert.equal(page.copy('https://x.com/alice/status/123?a=abc').output, 'https://x.com/alice/status/123');
  assert.deepEqual(page.copy('ordinary text'), { output: 'ordinary text', prevented: false });
});
