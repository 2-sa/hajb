import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const contentScript = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
const contentStyles = await readFile(new URL('../content/content.css', import.meta.url), 'utf8');

class FakeElement {
  constructor(tagName, notifyMutation) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.notifyMutation = notifyMutation;
    this.listeners = new Map();
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    this.notifyMutation(child, this);
  }

  insertBefore(child, reference) {
    child.parentElement = this;
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    this.notifyMutation(child, this);
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatchEvent(event) {
    const listeners = this.listeners.get(event.type) ?? [];
    await Promise.all(listeners.map((listener) => listener(event)));
  }

  click() {
    this.onClick?.();
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matches(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  matches(selector) {
    return matches(this, selector);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    return descendants(this).filter((element) => matches(element, selector));
  }
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function matches(element, selector) {
  if (selector.startsWith('.')) return element.className.split(/\s+/).includes(selector.slice(1));
  const testIdMatch = selector.match(/^\[data-testid="([^"]+)"\]$/);
  if (testIdMatch) return element.getAttribute('data-testid') === testIdMatch[1];
  const roleMatch = selector.match(/^\[role="([^"]+)"\]$/);
  if (roleMatch) return element.getAttribute('role') === roleMatch[1];
  if (selector === 'a[role="link"]') return element.tagName === 'A' && element.getAttribute('role') === 'link';
  if (selector.startsWith('article[data-testid="tweet"]')) {
    const isTweet = element.tagName === 'ARTICLE' && element.getAttribute('data-testid') === 'tweet';
    return isTweet;
  }
  return false;
}

function createPage(actionType = 'block', {
  deferStorageRead = false,
  deferTimers = false,
  menuItemTexts = [],
  storedSettings = {},
  tweetCount = 1
} = {}) {
  const mutationObservers = [];
  const notifyMutation = (node, target) => {
    for (const observer of mutationObservers) {
      observer.callback([{ addedNodes: [node], target }]);
    }
  };
  const createElement = (tagName) => new FakeElement(tagName, notifyMutation);
  const body = createElement('body');
  let primaryCaret = null;
  for (let index = 0; index < tweetCount; index += 1) {
    const tweet = createElement('article');
    const userName = createElement('div');
    const profileLink = createElement('a');
    const actions = createElement('div');
    const caret = createElement('button');
    tweet.setAttribute('data-testid', 'tweet');
    userName.setAttribute('data-testid', 'User-Name');
    profileLink.setAttribute('role', 'link');
    profileLink.textContent = index === 0 ? '@alice' : `@user${index + 1}`;
    actions.className = 'actions';
    caret.setAttribute('data-testid', 'caret');
    body.append(tweet);
    tweet.append(userName);
    userName.append(profileLink);
    tweet.append(actions);
    actions.append(caret);
    primaryCaret ??= caret;
  }
  const menu = createElement('div');
  let clickedMenuText = null;

  menu.setAttribute('data-testid', 'Dropdown');
  for (const text of menuItemTexts) {
    const item = createElement('button');
    item.setAttribute('role', 'menuitem');
    item.textContent = text;
    item.onClick = () => { clickedMenuText = text; };
    menu.append(item);
  }
  primaryCaret.onClick = () => {
    if (!menu.parentElement) body.append(menu);
  };

  const changeListeners = [];
  const runtimeMessages = [];
  let pendingStorageRead = null;
  const document = {
    body,
    readyState: 'complete',
    createElement,
    addEventListener() {},
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector)
  };
  const chrome = {
    i18n: {
      getMessage(key) {
        return {
          extName: 'HAJB',
          blockButtonLabel: 'Block account with one tap',
          muteButtonLabel: 'Mute account with one tap',
          notInterestedButtonLabel: 'Not interested in this post'
        }[key] ?? '';
      }
    },
    storage: {
      local: {
        get(defaults, callback) {
          const complete = () => callback({ ...defaults, ...storedSettings, actionType });
          if (deferStorageRead) pendingStorageRead = complete;
          else complete();
        }
      },
      onChanged: {
        addListener(listener) {
          changeListeners.push(listener);
        }
      }
    },
    runtime: {
      sendMessage(message) {
        runtimeMessages.push(message);
        return Promise.resolve({ ok: true });
      }
    }
  };
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      mutationObservers.push(this);
    }
    observe() {}
    disconnect() {}
  }
  let nextTimerId = 1;
  const timers = new Map();
  const setTimeout = (callback) => {
    const id = nextTimerId++;
    if (deferTimers) timers.set(id, callback);
    else callback();
    return id;
  };
  const clearTimeout = (id) => timers.delete(id);

  vm.runInNewContext(contentScript, {
    chrome,
    clearTimeout,
    console: { log() {}, error() {} },
    document,
    MutationObserver,
    setTimeout
  });

  return {
    document,
    completeStorageRead() {
      pendingStorageRead?.();
      pendingStorageRead = null;
    },
    getClickedMenuText() {
      return clickedMenuText;
    },
    getRuntimeMessages() {
      return runtimeMessages;
    },
    flushTimers() {
      while (timers.size > 0) {
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach((callback) => callback());
      }
    },
    emitStorageChange(nextActionType) {
      for (const listener of changeListeners) {
        listener({ actionType: { oldValue: actionType, newValue: nextActionType } }, 'local');
      }
      actionType = nextActionType;
    },
    emitSettingChange(key, newValue) {
      const oldValue = storedSettings[key];
      storedSettings[key] = newValue;
      for (const listener of changeListeners) {
        listener({ [key]: { oldValue, newValue } }, 'local');
      }
    }
  };
}

test('restores the action button when X replaces the tweet action bar', () => {
  const { document } = createPage();
  const tweet = document.querySelector('article[data-testid="tweet"]');

  assert.ok(tweet.querySelector('.hajb-action-btn'), 'precondition: button was injected');
  tweet.querySelector('.hajb-action-btn').remove();
  tweet.querySelector('.actions').append(document.createElement('span'));

  assert.ok(tweet.querySelector('.hajb-action-btn'));
});

test('keeps the visible action and accessible label in sync with settings', () => {
  const { document, emitStorageChange } = createPage('block');
  const button = document.querySelector('.hajb-account-action-btn');

  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.getAttribute('aria-label'), 'Block account with one tap');
  const blockIcon = button.innerHTML;

  emitStorageChange('mute');

  assert.equal(button.getAttribute('aria-label'), 'Mute account with one tap');
  assert.notEqual(button.innerHTML, blockIcon);
});

test('updates an already injected button when the initial storage read finishes late', () => {
  const { document, completeStorageRead } = createPage('mute', { deferStorageRead: true });
  const button = document.querySelector('.hajb-account-action-btn');
  assert.equal(button.getAttribute('aria-label'), 'Block account with one tap');

  completeStorageRead();

  assert.equal(button.getAttribute('aria-label'), 'Mute account with one tap');
});

test('restores the tweet inline styles when the X action menu cannot be opened', async () => {
  const { document } = createPage();
  const tweet = document.querySelector('article[data-testid="tweet"]');
  const button = document.querySelector('.hajb-account-action-btn');
  tweet.style.opacity = '0.75';
  tweet.style.pointerEvents = 'inherit';

  await document.body.dispatchEvent({
    type: 'click',
    target: button,
    preventDefault() {},
    stopPropagation() {}
  });

  assert.equal(tweet.style.opacity, '0.75');
  assert.equal(tweet.style.pointerEvents, 'inherit');
});

test('does not select the Arabic undo action when muting an account', async () => {
  const { document, getClickedMenuText } = createPage('mute', {
    menuItemTexts: ['إلغاء الكتم عن @alice', 'كتم @alice']
  });

  await document.body.dispatchEvent({
    type: 'click',
    target: document.querySelector('.hajb-account-action-btn'),
    preventDefault() {},
    stopPropagation() {}
  });

  assert.equal(getClickedMenuText(), 'كتم @alice');
});

test('injects a fixed not-interested button beside the configured account action', () => {
  const { document, emitStorageChange } = createPage('block');
  const actions = document.querySelector('.actions');
  const accountButton = document.querySelector('.hajb-account-action-btn');
  const notInterestedButton = document.querySelector('.hajb-not-interested-btn');

  assert.deepEqual(actions.children.slice(0, 3), [accountButton, notInterestedButton, actions.querySelector('[data-testid="caret"]')]);
  assert.equal(notInterestedButton.getAttribute('aria-label'), 'Not interested in this post');
  assert.equal(notInterestedButton.dataset.actionType, 'notInterested');

  emitStorageChange('mute');

  assert.equal(accountButton.dataset.actionType, 'mute');
  assert.equal(notInterestedButton.dataset.actionType, 'notInterested');
});

test('respects master and per-button visibility settings from the dashboard', () => {
  const accountDisabled = createPage('block', {
    storedSettings: { accountActionEnabled: false, notInterestedEnabled: true }
  });
  assert.equal(accountDisabled.document.querySelector('.hajb-account-action-btn').hidden, true);
  assert.equal(accountDisabled.document.querySelector('.hajb-not-interested-btn').hidden, false);

  const masterDisabled = createPage('block', {
    storedSettings: { hajbEnabled: false }
  });
  assert.equal(masterDisabled.document.querySelector('.hajb-account-action-btn').hidden, true);
  assert.equal(masterDisabled.document.querySelector('.hajb-not-interested-btn').hidden, true);
});

test('updates button visibility immediately when dashboard switches change', () => {
  const { document, emitSettingChange } = createPage();
  const accountButton = document.querySelector('.hajb-account-action-btn');
  const notInterestedButton = document.querySelector('.hajb-not-interested-btn');

  emitSettingChange('accountActionEnabled', false);
  assert.equal(accountButton.hidden, true);
  assert.equal(notInterestedButton.hidden, false);

  emitSettingChange('notInterestedEnabled', false);
  assert.equal(notInterestedButton.hidden, true);

  emitSettingChange('accountActionEnabled', true);
  assert.equal(accountButton.hidden, false);
});

test('hidden action buttons override their flex display rule', () => {
  assert.match(
    contentStyles,
    /\.hajb-action-btn\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/s
  );
});

test('selects not interested in this post, records it, and avoids the similarly named Topic action', async () => {
  const { document, getClickedMenuText, getRuntimeMessages } = createPage('block', {
    menuItemTexts: ['Not interested in this Topic', 'Not interested in this post']
  });
  const tweet = document.querySelector('article[data-testid="tweet"]');

  await document.body.dispatchEvent({
    type: 'click',
    target: document.querySelector('.hajb-not-interested-btn'),
    preventDefault() {},
    stopPropagation() {}
  });

  assert.equal(getClickedMenuText(), 'Not interested in this post');
  assert.equal(tweet.style.display, 'none');
  assert.equal(JSON.stringify(getRuntimeMessages()), JSON.stringify([{
    type: 'HAJB_RECORD_ACTION',
    actionType: 'notInterested'
  }]));
});

test('selects the Arabic not-interested post action without selecting the Topic action', async () => {
  const { document, getClickedMenuText } = createPage('block', {
    menuItemTexts: ['غير مهتم بهذا الموضوع', 'غير مهتم بهذا المنشور']
  });

  await document.body.dispatchEvent({
    type: 'click',
    target: document.querySelector('.hajb-not-interested-btn'),
    preventDefault() {},
    stopPropagation() {}
  });

  assert.equal(getClickedMenuText(), 'غير مهتم بهذا المنشور');
});

test('merges affected tweets across the observer debounce window', () => {
  const { document, flushTimers } = createPage('block', { deferTimers: true, tweetCount: 2 });
  flushTimers();
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');

  for (const tweet of tweets) {
    tweet.querySelector('.hajb-account-action-btn').remove();
    tweet.querySelector('.hajb-not-interested-btn').remove();
  }
  tweets[0].querySelector('.actions').append(document.createElement('span'));
  tweets[1].querySelector('.actions').append(document.createElement('span'));
  flushTimers();

  assert.ok(tweets[0].querySelector('.hajb-account-action-btn'));
  assert.ok(tweets[0].querySelector('.hajb-not-interested-btn'));
  assert.ok(tweets[1].querySelector('.hajb-account-action-btn'));
  assert.ok(tweets[1].querySelector('.hajb-not-interested-btn'));
});
