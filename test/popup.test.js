import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const popupScript = await readFile(new URL('../popup/popup.js', import.meta.url), 'utf8');
const popupMarkup = await readFile(new URL('../popup/popup.html', import.meta.url), 'utf8');

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
      listeners.get(type)?.();
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
    'footerStatus',
    'resetStats',
    'blockCount',
    'muteCount',
    'notInterestedCount',
    'totalCount'
  ].map((id) => [id, createElement()]));
  const documentElement = { lang: 'ar', dir: 'rtl' };
  const savedSettings = [];
  const changeListeners = [];
  let requestedDefaults;

  const document = {
    documentElement,
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') listener();
    },
    getElementById(id) {
      return ids[id];
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
        addListener(listener) {
          changeListeners.push(listener);
        }
      }
    }
  };

  vm.runInNewContext(popupScript, { chrome, document, Intl });
  return {
    actionInputs,
    documentElement,
    elements: ids,
    requestedDefaults,
    savedSettings,
    emitStorageChange(changes, area = 'local') {
      changeListeners.forEach((listener) => listener(changes, area));
    }
  };
}

test('renders the HAJB dashboard controls and three action counters', () => {
  assert.match(popupMarkup, /class="brand-name"[^>]*>HAJB</);
  assert.match(popupMarkup, /id="hajbEnabled"/);
  assert.match(popupMarkup, /id="accountActionEnabled"/);
  assert.match(popupMarkup, /id="notInterestedEnabled"/);
  assert.match(popupMarkup, /id="blockCount"/);
  assert.match(popupMarkup, /id="muteCount"/);
  assert.match(popupMarkup, /id="notInterestedCount"/);
});

test('loads controls, uses the browser direction, and persists feature switches', () => {
  const popup = runPopup('en-US', {
    actionType: 'mute',
    accountActionEnabled: false
  });
  const [blockInput, muteInput] = popup.actionInputs;

  assert.equal(popup.documentElement.lang, 'en');
  assert.equal(popup.documentElement.dir, 'ltr');
  assert.equal(popup.requestedDefaults.hajbEnabled, true);
  assert.equal(popup.elements.hajbEnabled.checked, true);
  assert.equal(popup.elements.accountActionEnabled.checked, false);
  assert.equal(muteInput.checked, true);
  assert.equal(blockInput.disabled, true);
  assert.equal(popup.elements.accountFeatureCard.classList.contains('is-disabled'), true);

  popup.elements.accountActionEnabled.checked = true;
  popup.elements.accountActionEnabled.dispatch('change');

  assert.equal(JSON.stringify(popup.savedSettings.at(-1)), JSON.stringify({ accountActionEnabled: true }));
  assert.equal(blockInput.disabled, false);
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
});

test('renders live action stats and resets them locally', () => {
  const popup = runPopup('en-US', {
    actionStats: { block: 12, mute: 3, notInterested: 29 }
  });

  assert.equal(popup.elements.blockCount.textContent, '12');
  assert.equal(popup.elements.muteCount.textContent, '3');
  assert.equal(popup.elements.notInterestedCount.textContent, '29');
  assert.equal(popup.elements.totalCount.textContent, '44');

  popup.emitStorageChange({
    actionStats: { newValue: { block: 13, mute: 3, notInterested: 30 } }
  });
  assert.equal(popup.elements.totalCount.textContent, '46');

  popup.elements.resetStats.dispatch('click');
  assert.equal(JSON.stringify(popup.savedSettings.at(-1)), JSON.stringify({
    actionStats: { block: 0, mute: 0, notInterested: 0 }
  }));
  assert.equal(popup.elements.totalCount.textContent, '0');
});

test('uses the Arabic fallback direction for unsupported browser locales', () => {
  const popup = runPopup('fr-FR');
  assert.equal(popup.documentElement.lang, 'ar');
  assert.equal(popup.documentElement.dir, 'rtl');
});
