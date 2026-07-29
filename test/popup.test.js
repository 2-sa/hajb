import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const popupScript = await readFile(new URL('../popup/popup.js', import.meta.url), 'utf8');
const popupMarkup = await readFile(new URL('../popup/popup.html', import.meta.url), 'utf8');

function createRadio(value) {
  const listeners = new Map();
  return {
    value,
    checked: false,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatchChange() {
      listeners.get('change')?.();
    }
  };
}

function runPopup(uiLanguage = 'en-US') {
  const actionInputs = [createRadio('block'), createRadio('mute')];
  const documentElement = { lang: 'ar', dir: 'rtl' };
  let requestedDefaults;
  let savedSettings = null;

  const document = {
    documentElement,
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') listener();
    },
    querySelectorAll(selector) {
      if (selector === 'input[name="actionType"]') return actionInputs;
      return [];
    }
  };
  const chrome = {
    i18n: {
      getMessage() { return ''; },
      getUILanguage() { return uiLanguage; }
    },
    storage: {
      local: {
        get(defaults, callback) {
          requestedDefaults = defaults;
          callback({ ...defaults, actionType: 'mute' });
        },
        set(settings) {
          savedSettings = settings;
        }
      }
    }
  };

  vm.runInNewContext(popupScript, { chrome, document });
  return {
    actionInputs,
    documentElement,
    requestedDefaults,
    getSavedSettings: () => savedSettings
  };
}

test('renders the HAJB brand and exposes block and mute as direct choices', () => {
  assert.match(popupMarkup, /class="brand-name"[^>]*>HAJB</);
  assert.match(popupMarkup, /src="\.\.\/icons\/brand-mark\.svg"/);
  assert.match(popupMarkup, /role="radiogroup"/);
  assert.match(popupMarkup, /value="block"/);
  assert.match(popupMarkup, /value="mute"/);
});

test('uses the browser UI direction and persists the selected one-tap action', () => {
  const popup = runPopup('en-US');
  const [blockInput, muteInput] = popup.actionInputs;

  assert.equal(popup.documentElement.lang, 'en');
  assert.equal(popup.documentElement.dir, 'ltr');
  assert.equal(JSON.stringify(popup.requestedDefaults), '{"actionType":"block"}');
  assert.equal(muteInput.checked, true);

  blockInput.checked = true;
  blockInput.dispatchChange();
  assert.equal(JSON.stringify(popup.getSavedSettings()), '{"actionType":"block"}');
});

test('uses the Arabic fallback direction for unsupported browser locales', () => {
  const popup = runPopup('fr-FR');

  assert.equal(popup.documentElement.lang, 'ar');
  assert.equal(popup.documentElement.dir, 'rtl');
});
