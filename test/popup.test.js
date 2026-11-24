import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const popupScript = await readFile(new URL('../popup/popup.js', import.meta.url), 'utf8');
const popupMarkup = await readFile(new URL('../popup/popup.html', import.meta.url), 'utf8');
const popupStyles = await readFile(new URL('../popup/popup.css', import.meta.url), 'utf8');
const arLocale = JSON.parse(await readFile(new URL('../_locales/ar/messages.json', import.meta.url), 'utf8'));
const enLocale = JSON.parse(await readFile(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));

function createElement(value = '') {
  const listeners = new Map();
  const classes = new Set();
  return {
    value,
    checked: false,
    disabled: false,
    textContent: '',
    classList: {
      contains: (className) => classes.has(className),
      toggle(className, force) {
        if (force) classes.add(className);
        else classes.delete(className);
      }
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type) {
      return listeners.get(type)?.();
    }
  };
}

function runPopup(uiLanguage = 'en-US', stored = {}) {
  const actionInputs = [createElement('block'), createElement('mute')];
  const ids = Object.fromEntries([
    'hajbEnabled',
    'accountActionEnabled',
    'notInterestedEnabled',
    'accountFeatureCard',
    'notInterestedFeatureCard',
    'signalRail',
    'masterStatus',
    'statusDot',
    'footerStatus'
  ].map((id) => [id, createElement()]));
  const documentElement = { lang: 'ar', dir: 'rtl' };
  const savedSettings = [];
  let onChangedRegistered = false;
  let sendMessageCalled = false;
  let requestedDefaults;

  const document = {
    documentElement,
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') listener();
    },
    getElementById(id) {
      return ids[id] ?? null;
    },
    querySelectorAll(selector) {
      if (selector === 'input[name="actionType"]') return actionInputs;
      return [];
    }
  };
  const messages = {
    activeLabel: 'Active',
    pausedLabel: 'Paused',
    activeFooterStatus: 'Active locally',
    pausedFooterStatus: 'Paused locally'
  };
  const chrome = {
    runtime: {
      sendMessage() {
        sendMessageCalled = true;
        return Promise.resolve({ ok: true });
      }
    },
    i18n: {
      getMessage(key) { return messages[key] ?? ''; },
      getUILanguage() { return uiLanguage; }
    },
    storage: {
      local: {
        get(defaults, callback) {
          requestedDefaults = defaults;
          callback({ ...defaults, ...stored });
        },
        set(settings) {
          savedSettings.push(settings);
        }
      },
      onChanged: {
        addListener() {
          onChangedRegistered = true;
        }
      }
    }
  };

  vm.runInNewContext(popupScript, { chrome, document, console: { error() {} } });
  return {
    actionInputs,
    documentElement,
    elements: ids,
    requestedDefaults,
    savedSettings,
    onChangedRegistered,
    sendMessageCalled
  };
}

test('renders the One Click Block dashboard controls without action counters', () => {
  assert.match(popupMarkup, /class="brand-name"[^>]*>ONE CLICK BLOCK</);
  assert.match(popupMarkup, /id="hajbEnabled"/);
  assert.match(popupMarkup, /id="accountActionEnabled"/);
  assert.match(popupMarkup, /id="notInterestedEnabled"/);
  assert.match(popupMarkup, /id="accountButtonTitle"/);
  assert.match(popupMarkup, /id="actionChoices"[^>]*aria-labelledby="accountButtonTitle"/);
  assert.doesNotMatch(popupMarkup, /id="actionChoices"[^>]*aria-label=/);
  assert.doesNotMatch(popupMarkup, /stats-section|blockCount|muteCount|notInterestedCount|totalCount|resetStats/);
  assert.doesNotMatch(popupStyles, /min-height:\s*520px|\.stats-section|\.stats-strip/);
});

test('loads controls, uses the browser direction, persists switches, and avoids background messaging', () => {
  const popup = runPopup('en-US', {
    actionType: 'mute',
    accountActionEnabled: false
  });
  const [blockInput, muteInput] = popup.actionInputs;

  assert.equal(popup.documentElement.lang, 'en');
  assert.equal(popup.documentElement.dir, 'ltr');
  assert.deepEqual(Object.keys(popup.requestedDefaults).sort(), [
    'accountActionEnabled',
    'actionType',
    'hajbEnabled',
    'notInterestedEnabled'
  ]);
  assert.equal(popup.onChangedRegistered, false);
  assert.equal(popup.sendMessageCalled, false);
  assert.equal(popup.elements.hajbEnabled.checked, true);
  assert.equal(popup.elements.accountActionEnabled.checked, false);
  assert.equal(muteInput.checked, true);
  assert.equal(blockInput.disabled, true);
  assert.equal(popup.elements.accountFeatureCard.classList.contains('is-disabled'), true);

  popup.elements.accountActionEnabled.checked = true;
  popup.elements.accountActionEnabled.dispatch('change');

  assert.equal(JSON.stringify(popup.savedSettings.at(-1)), JSON.stringify({ accountActionEnabled: true }));
  assert.equal(blockInput.disabled, false);

  blockInput.checked = true;
  blockInput.dispatch('change');
  assert.equal(JSON.stringify(popup.savedSettings.at(-1)), JSON.stringify({ actionType: 'block' }));
});

test('the master switch pauses every timeline control without forgetting preferences', () => {
  const popup = runPopup('en-US');

  popup.elements.hajbEnabled.checked = false;
  popup.elements.hajbEnabled.dispatch('change');

  assert.equal(JSON.stringify(popup.savedSettings.at(-1)), JSON.stringify({ hajbEnabled: false }));
  assert.equal(popup.elements.accountActionEnabled.checked, true);
  assert.equal(popup.elements.notInterestedEnabled.checked, true);
  assert.equal(popup.actionInputs.every((input) => input.disabled), true);
  assert.equal(popup.elements.signalRail.classList.contains('is-paused'), true);
  assert.equal(popup.elements.masterStatus.textContent, 'Paused');
  assert.equal(popup.elements.footerStatus.textContent, 'Paused locally');
});

test('uses the Arabic fallback direction for unsupported browser locales', () => {
  const popup = runPopup('fr-FR');
  assert.equal(popup.documentElement.lang, 'ar');
  assert.equal(popup.documentElement.dir, 'rtl');
});

test('prunes stats and unused locale message keys from both locales', () => {
  const removedKeys = [
    'modeEyebrow',
    'actionTypeLabel',
    'privacyNote',
    'statsEyebrow',
    'statsTitle',
    'resetStats',
    'blockStat',
    'muteStat',
    'notInterestedStat',
    'totalLabel'
  ];
  for (const key of removedKeys) {
    assert.equal(Object.hasOwn(arLocale, key), false, `ar locale still contains ${key}`);
    assert.equal(Object.hasOwn(enLocale, key), false, `en locale still contains ${key}`);
  }
});
