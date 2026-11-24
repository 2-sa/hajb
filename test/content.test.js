import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const contentScript = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
const contentStyles = await readFile(new URL('../content/content.css', import.meta.url), 'utf8');

class FakeElement {
  constructor(tagName, notifyMutation, rootRef, counters, namespaceURI = null) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.namespaceURI = namespaceURI;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.className = '';
    this.textContent = '';
    this._innerHTML = '';
    this.notifyMutation = notifyMutation;
    this.rootRef = rootRef;
    this.counters = counters;
    this.listeners = new Map();
    this.classList = {
      contains: (className) => this.className.split(/\s+/).includes(className)
    };
  }

  get id() {
    return this.attributes.id ?? '';
  }

  set id(value) {
    this.attributes.id = String(value);
  }

  get isConnected() {
    let current = this;
    while (current) {
      if (current === this.rootRef.body) return true;
      current = current.parentElement;
    }
    return false;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this.counters.innerHTMLWrites += 1;
    this._innerHTML = String(value);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  _detachChild(child) {
    if (!child.parentElement) return;
    const oldParent = child.parentElement;
    const idx = oldParent.children.indexOf(child);
    if (idx >= 0) oldParent.children.splice(idx, 1);
    child.parentElement = null;
  }

  append(...nodes) {
    for (const child of nodes) {
      this._detachChild(child);
      child.parentElement = this;
      this.children.push(child);
      this.notifyMutation({ addedNodes: [child], removedNodes: [], target: this });
    }
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  insertBefore(child, reference) {
    this._detachChild(child);
    child.parentElement = this;
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    this.notifyMutation({ addedNodes: [child], removedNodes: [], target: this });
    return child;
  }

  replaceChildren(...nodes) {
    const removed = this.children.splice(0);
    for (const child of removed) child.parentElement = null;
    for (const child of nodes) {
      this._detachChild(child);
      child.parentElement = this;
      this.children.push(child);
    }
    this.notifyMutation({ addedNodes: nodes, removedNodes: removed, target: this });
  }

  remove() {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parentElement = null;
    this.notifyMutation({ addedNodes: [], removedNodes: [this], target: parent });
  }

  cloneNode(deep = false) {
    const copy = new FakeElement(this.tagName, this.notifyMutation, this.rootRef, this.counters, this.namespaceURI);
    copy.attributes = { ...this.attributes };
    copy.className = this.className;
    copy.dataset = { ...this.dataset };
    copy.textContent = this.textContent;
    if (deep) {
      for (const child of this.children) {
        const childCopy = child.cloneNode(true);
        childCopy.parentElement = copy;
        copy.children.push(childCopy);
      }
    }
    return copy;
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
    if (selector === '.hajb-action-btn') this.counters.ownButtonClosestCalls += 1;
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
    if (selector === '[data-testid="User-Name"]') this.counters.userNameQueries += 1;
    return this.querySelectorAll(selector)[0] ?? null;
  }

  contains(node) {
    while (node) {
      if (node === this) return true;
      node = node.parentElement;
    }
    return false;
  }

  querySelectorAll(selector) {
    return descendants(this).filter((element) => matches(element, selector));
  }
}

function descendants(element) {
  return element.children.flatMap((child) => (child.nodeType === 1 ? [child, ...descendants(child)] : []));
}

function matches(element, selector) {
  if (element.nodeType !== 1) return false;
  if (selector.startsWith('.')) return element.className.split(/\s+/).includes(selector.slice(1));
  const testIdMatch = selector.match(/^\[data-testid="([^"]+)"\]$/);
  if (testIdMatch) return element.getAttribute('data-testid') === testIdMatch[1];
  const roleMatch = selector.match(/^\[role="([^"]+)"\]$/);
  if (roleMatch) return element.getAttribute('role') === roleMatch[1];
  if (selector === 'a[role="link"]') return element.tagName === 'A' && element.getAttribute('role') === 'link';
  if (selector.startsWith('article[data-testid="tweet"]')) {
    return element.tagName === 'ARTICLE' && element.getAttribute('data-testid') === 'tweet';
  }
  return false;
}

function createPage(actionType = 'block', {
  deferStorageRead = false,
  deferTimers = false,
  hidden = false,
  menuItemTexts = [],
  storedSettings = {},
  storageReturnsUndefined = false,
  tweetCount = 1,
  withReactRoot = false,
  withLayers = false
} = {}) {
  const mutationObservers = [];
  const counters = {
    i18nCalls: 0,
    innerHTMLWrites: 0,
    ownButtonClosestCalls: 0,
    userNameQueries: 0,
    consoleLogs: 0
  };
  const rootRef = { body: null };
  const notifyMutation = (record) => {
    for (const observer of mutationObservers) {
      if (observer.active && observer.target?.contains(record.target)) {
        observer.callback([record]);
      }
    }
  };
  const createElement = (tagName) => new FakeElement(tagName, notifyMutation, rootRef, counters);
  const createElementNS = (ns, tagName) => new FakeElement(tagName, notifyMutation, rootRef, counters, ns);
  const body = createElement('body');
  rootRef.body = body;

  const byId = new Map();
  let tweetContainer = body;
  if (withReactRoot) {
    const reactRoot = createElement('div');
    reactRoot.setAttribute('id', 'react-root');
    body.append(reactRoot);
    byId.set('react-root', reactRoot);
    tweetContainer = reactRoot;
  }
  let layers = null;
  if (withLayers) {
    layers = createElement('div');
    layers.setAttribute('id', 'layers');
    (withReactRoot ? byId.get('react-root') : body).append(layers);
    byId.set('layers', layers);
  }

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
    tweetContainer.append(tweet);
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
  if (primaryCaret) {
    primaryCaret.onClick = () => {
      const menuHost = layers ?? body;
      if (!menu.parentElement) menuHost.append(menu);
    };
  }

  const changeListeners = [];
  const runtimeMessages = [];
  let pendingStorageRead = null;
  const document = {
    body,
    hidden,
    readyState: 'complete',
    createElement,
    createElementNS,
    getElementById: (id) => byId.get(id) ?? null,
    addEventListener: (type, listener) => body.addEventListener(type, listener),
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector)
  };
  const chrome = {
    i18n: {
      getMessage(key) {
        counters.i18nCalls += 1;
        return {
          extName: 'One Click Block Twitter',
          blockButtonLabel: 'Block account with one tap',
          muteButtonLabel: 'Mute account with one tap',
          notInterestedButtonLabel: 'Not interested in this post'
        }[key] ?? '';
      }
    },
    storage: {
      local: {
        get(defaults, callback) {
          const complete = () => callback(
            storageReturnsUndefined ? undefined : { ...defaults, ...storedSettings, actionType }
          );
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
      this.active = false;
      this.target = null;
      mutationObservers.push(this);
    }
    observe(target) {
      this.active = true;
      this.target = target;
    }
    disconnect() {
      this.active = false;
    }
  }
  let nextTimerId = 1;
  let currentTime = 0;
  const timers = new Map();
  const setTimeout = (callback, delay = 0) => {
    const id = nextTimerId++;
    if (deferTimers) timers.set(id, { callback, dueAt: currentTime + delay });
    else callback();
    return id;
  };
  const clearTimeout = (id) => timers.delete(id);
  const advanceTime = (milliseconds) => {
    currentTime += milliseconds;
    while (true) {
      const dueTimers = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= currentTime)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt);
      if (dueTimers.length === 0) break;
      for (const [id, timer] of dueTimers) {
        timers.delete(id);
        timer.callback();
      }
    }
  };

  vm.runInNewContext(contentScript, {
    chrome,
    clearTimeout,
    console: {
      log() { counters.consoleLogs += 1; },
      error() {}
    },
    document,
    MutationObserver,
    setTimeout
  });

  return {
    document,
    counters,
    mutationObservers,
    tweetContainer,
    layers,
    activeObservers: () => mutationObservers.filter((observer) => observer.active).length,
    pendingTimerCount: () => timers.size,
    setHidden(nextHidden) {
      document.hidden = nextHidden;
      return body.dispatchEvent({ type: 'visibilitychange' });
    },
    advanceTime,
    completeStorageRead() {
      pendingStorageRead?.();
      pendingStorageRead = null;
    },
    dispatchRawMutations(records) {
      for (const observer of mutationObservers) {
        if (observer.active) observer.callback(records);
      }
    },
    getClickedMenuText() {
      return clickedMenuText;
    },
    getRuntimeMessages() {
      return runtimeMessages;
    },
    flushTimers() {
      while (timers.size > 0) {
        const nextDueAt = Math.min(...[...timers.values()].map((timer) => timer.dueAt));
        advanceTime(nextDueAt - currentTime);
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

test('builds icons via createElementNS without innerHTML and caches i18n labels', () => {
  const page = createPage('block', { tweetCount: 30 });
  const button = page.document.querySelector('.hajb-account-action-btn');

  assert.equal(page.counters.innerHTMLWrites, 0);
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.children[0].tagName, 'SVG');
  assert.equal(button.children[0].namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(button.children[0].children[0].tagName, 'PATH');
  assert.equal(button.getAttribute('aria-label'), 'Block account with one tap');
  assert.equal(page.counters.i18nCalls, 2);

  const blockPath = button.children[0].children[0].getAttribute('d');
  page.emitStorageChange('mute');

  assert.equal(page.counters.innerHTMLWrites, 0);
  assert.equal(button.getAttribute('aria-label'), 'Mute account with one tap');
  assert.notEqual(button.children[0].children[0].getAttribute('d'), blockPath);
  assert.equal(page.counters.i18nCalls, 3);
});

test('waits for initial storage read before starting observer or injecting buttons', () => {
  const disabledPage = createPage('block', {
    deferStorageRead: true,
    storedSettings: { hajbEnabled: false }
  });
  assert.equal(disabledPage.activeObservers(), 0);
  assert.equal(disabledPage.document.querySelector('.hajb-action-btn'), null);

  disabledPage.completeStorageRead();
  assert.equal(disabledPage.activeObservers(), 0);
  assert.equal(disabledPage.document.querySelector('.hajb-action-btn'), null);

  const mutePage = createPage('mute', { deferStorageRead: true });
  assert.equal(mutePage.activeObservers(), 0);
  assert.equal(mutePage.document.querySelector('.hajb-account-action-btn'), null);

  mutePage.completeStorageRead();
  const button = mutePage.document.querySelector('.hajb-account-action-btn');
  assert.equal(button.getAttribute('aria-label'), 'Mute account with one tap');
  assert.equal(mutePage.counters.i18nCalls, 2);
});

test('falls back to default settings if initial storage read yields undefined', () => {
  const page = createPage('block', { storageReturnsUndefined: true });
  assert.equal(page.activeObservers(), 1);
  assert.ok(page.document.querySelector('.hajb-account-action-btn'));
  assert.ok(page.document.querySelector('.hajb-not-interested-btn'));
});

test('only injects enabled buttons and removes disabled buttons from the DOM', () => {
  const accountDisabled = createPage('block', {
    storedSettings: { accountActionEnabled: false, notInterestedEnabled: true }
  });
  assert.equal(accountDisabled.document.querySelector('.hajb-account-action-btn'), null);
  assert.ok(accountDisabled.document.querySelector('.hajb-not-interested-btn'));

  const page = createPage('block');
  assert.ok(page.document.querySelector('.hajb-account-action-btn'));
  assert.ok(page.document.querySelector('.hajb-not-interested-btn'));

  page.emitSettingChange('accountActionEnabled', false);
  assert.equal(page.document.querySelector('.hajb-account-action-btn'), null);
  assert.ok(page.document.querySelector('.hajb-not-interested-btn'));

  page.emitSettingChange('notInterestedEnabled', false);
  assert.equal(page.document.querySelector('.hajb-not-interested-btn'), null);
  assert.equal(page.activeObservers(), 0);

  page.emitSettingChange('accountActionEnabled', true);
  assert.equal(page.activeObservers(), 1);
  assert.ok(page.document.querySelector('.hajb-account-action-btn'));
  assert.equal(page.document.querySelector('.hajb-not-interested-btn'), null);

  page.emitSettingChange('notInterestedEnabled', true);
  const actions = page.document.querySelector('.actions');
  assert.deepEqual(
    actions.children.slice(0, 3),
    [
      page.document.querySelector('.hajb-account-action-btn'),
      page.document.querySelector('.hajb-not-interested-btn'),
      actions.querySelector('[data-testid="caret"]')
    ]
  );

  page.emitSettingChange('hajbEnabled', false);
  assert.equal(page.document.querySelector('.hajb-action-btn'), null);
  assert.equal(page.activeObservers(), 0);
});

test('defers DOM updates when settings change in hidden tabs and reconciles on resume', async () => {
  const page = createPage('block', { deferTimers: true });
  page.flushTimers();

  await page.setHidden(true);
  let scansWhileHidden = 0;
  const originalQsa = page.document.querySelectorAll;
  page.document.querySelectorAll = (...args) => { scansWhileHidden += 1; return originalQsa(...args); };

  page.emitSettingChange('accountActionEnabled', false);
  page.emitStorageChange('mute');
  page.emitSettingChange('accountActionEnabled', true);
  assert.equal(scansWhileHidden, 0);

  page.document.querySelectorAll = originalQsa;
  await page.setHidden(false);
  page.flushTimers();

  const button = page.document.querySelector('.hajb-account-action-btn');
  assert.equal(button.dataset.actionType, 'mute');
  assert.equal(button.getAttribute('aria-label'), 'Mute account with one tap');

  await page.setHidden(true);
  page.emitSettingChange('hajbEnabled', false);
  assert.ok(page.document.querySelector('.hajb-action-btn'), 'does not mutate DOM while hidden');

  await page.setHidden(false);
  assert.equal(page.document.querySelector('.hajb-action-btn'), null);
  assert.equal(page.activeObservers(), 0);
});

test('scopes timeline observer to #react-root and skips leaf tags and own-button closest walks', () => {
  const page = createPage('block', { deferTimers: true, withReactRoot: true });
  page.flushTimers();

  assert.equal(page.mutationObservers[0].target, page.document.getElementById('react-root'));
  page.counters.ownButtonClosestCalls = 0;

  let leafQueryScans = 0;
  const span = page.document.createElement('span');
  const innerSpan = page.document.createElement('span');
  span.append(innerSpan);
  span.querySelectorAll = () => { leafQueryScans += 1; return []; };
  page.tweetContainer.append(span);

  const outsidePortal = page.document.createElement('div');
  page.document.body.append(outsidePortal);

  assert.equal(leafQueryScans, 0);
  assert.equal(page.counters.ownButtonClosestCalls, 0);
  assert.equal(page.pendingTimerCount(), 0);
});

test('deduplicates repeated mutation targets within a single observer callback', () => {
  const page = createPage('block', { deferTimers: true });
  page.flushTimers();
  const tweet = page.document.querySelector('article[data-testid="tweet"]');
  const user = tweet.querySelector('[data-testid="User-Name"]');

  let closestCount = 0;
  const originalClosest = user.closest.bind(user);
  user.closest = (selector) => { closestCount += 1; return originalClosest(selector); };

  const child = page.document.createElement('span');
  page.dispatchRawMutations(Array.from({ length: 20 }, () => ({
    target: user,
    addedNodes: [child],
    removedNodes: []
  })));

  assert.equal(closestCount, 1);
});

test('evicts detached queued tweets immediately without consuming the 20-tweet injection budget', () => {
  const page = createPage('block', { deferTimers: true, tweetCount: 0 });
  page.flushTimers();

  const detachedTweets = [];
  for (let i = 0; i < 100; i += 1) {
    const tweet = page.document.createElement('article');
    tweet.setAttribute('data-testid', 'tweet');
    const caret = page.document.createElement('button');
    caret.setAttribute('data-testid', 'caret');
    tweet.append(caret);
    page.document.body.append(tweet);
    detachedTweets.push(tweet);
  }
  for (const tweet of detachedTweets) tweet.remove();

  for (let i = 0; i < 10; i += 1) {
    const tweet = page.document.createElement('article');
    tweet.setAttribute('data-testid', 'tweet');
    const caret = page.document.createElement('button');
    caret.setAttribute('data-testid', 'caret');
    tweet.append(caret);
    page.document.body.append(tweet);
  }

  page.advanceTime(32);
  assert.equal(page.document.querySelectorAll('.hajb-action-btn').length, 20);
  assert.equal(page.pendingTimerCount(), 0);
});

test('handles caret-less tweets without throwing and scopes button lookup to caret parent', () => {
  const page = createPage('block', { tweetCount: 0 });
  const caretless = page.document.createElement('article');
  caretless.setAttribute('data-testid', 'tweet');
  page.document.body.append(caretless);
  assert.equal(caretless.querySelector('.hajb-action-btn'), null);

  const tweet = page.document.createElement('article');
  tweet.setAttribute('data-testid', 'tweet');
  const quoted = page.document.createElement('div');
  const strayBtn = page.document.createElement('button');
  strayBtn.className = 'hajb-action-btn hajb-account-action-btn';
  quoted.append(strayBtn);
  const actions = page.document.createElement('div');
  const caret = page.document.createElement('button');
  caret.setAttribute('data-testid', 'caret');
  actions.append(caret);
  tweet.append(quoted);
  tweet.append(actions);
  page.document.body.append(tweet);

  assert.equal(actions.children.filter((c) => c.classList.contains('hajb-account-action-btn')).length, 1);
  assert.equal(actions.children.filter((c) => c.classList.contains('hajb-not-interested-btn')).length, 1);
});

test('scopes menu waitForElement to #layers, prevents concurrent action collisions, and skips logging or background messaging', async () => {
  const page = createPage('mute', {
    deferTimers: true,
    tweetCount: 2,
    withReactRoot: true,
    withLayers: true
  });
  page.flushTimers();
  const tweets = page.document.querySelectorAll('article[data-testid="tweet"]');
  const buttons = page.document.querySelectorAll('.hajb-account-action-btn');
  tweets[0].querySelector('[data-testid="caret"]').onClick = () => {};
  tweets[1].querySelector('[data-testid="caret"]').onClick = () => {};

  const firstClick = page.document.body.dispatchEvent({
    type: 'click',
    target: buttons[0],
    preventDefault() {},
    stopPropagation() {}
  });

  const menuObserver = page.mutationObservers[1];
  assert.equal(menuObserver.target, page.layers);

  // Overlapping click on second tweet must be ignored while first action is inFlight
  await page.document.body.dispatchEvent({
    type: 'click',
    target: buttons[1],
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(tweets[1].style.opacity, undefined);

  const menu = page.document.createElement('div');
  menu.setAttribute('data-testid', 'Dropdown');
  const item = page.document.createElement('button');
  item.setAttribute('role', 'menuitem');
  item.textContent = 'Mute @alice';
  menu.append(item);
  page.layers.append(menu);

  await firstClick;
  assert.equal(tweets[0].style.display, 'none');
  assert.equal(page.activeObservers(), 1);
  assert.equal(page.pendingTimerCount(), 0);
  assert.equal(page.getRuntimeMessages().length, 0);
  assert.equal(page.counters.consoleLogs, 0);
  assert.equal(page.counters.userNameQueries, 0);

  // Lock must be released after completion so second tweet can now be acted upon
  const secondClick = page.document.body.dispatchEvent({
    type: 'click',
    target: buttons[1],
    preventDefault() {},
    stopPropagation() {}
  });
  await secondClick;
  assert.equal(tweets[1].style.display, 'none');
});

test('restores the tweet inline styles and releases lock when the X action menu cannot be opened', async () => {
  const page = createPage('block');
  const tweet = page.document.querySelector('article[data-testid="tweet"]');
  const button = page.document.querySelector('.hajb-account-action-btn');
  tweet.style.opacity = '0.75';
  tweet.style.pointerEvents = 'inherit';

  await page.document.body.dispatchEvent({
    type: 'click',
    target: button,
    preventDefault() {},
    stopPropagation() {}
  });

  assert.equal(tweet.style.opacity, '0.75');
  assert.equal(tweet.style.pointerEvents, 'inherit');

  // Verify lock was released after failure by triggering a second attempt
  let caretClicked = 0;
  tweet.querySelector('[data-testid="caret"]').onClick = () => { caretClicked += 1; };
  await page.document.body.dispatchEvent({
    type: 'click',
    target: button,
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(caretClicked, 1);
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

test('selects not interested in this post without background messaging and avoids the Topic action', async () => {
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
  assert.equal(getRuntimeMessages().length, 0);
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

test('injects actions while X keeps mutating the timeline', () => {
  const { document, advanceTime, flushTimers } = createPage('block', { deferTimers: true });
  flushTimers();
  const tweet = document.querySelector('article[data-testid="tweet"]');
  const actions = tweet.querySelector('.actions');

  tweet.querySelector('.hajb-account-action-btn').remove();
  for (let index = 0; index < 20; index += 1) {
    actions.append(document.createElement('span'));
    advanceTime(50);
  }

  assert.ok(tweet.querySelector('.hajb-account-action-btn'));
});

test('unrelated storage events do not redraw or scan timeline controls', () => {
  const page = createPage();
  let scans = 0;
  const original = page.document.querySelectorAll;
  page.document.querySelectorAll = (...args) => { scans += 1; return original(...args); };
  for (let i = 0; i < 100; i += 1) page.emitSettingChange('unrelatedKey', { count: i });
  assert.equal(scans, 0);
});

test('ordinary tweet updates reuse intact controls without querying the tweet again', () => {
  const page = createPage('block', { deferTimers: true });
  page.flushTimers();
  const tweet = page.document.querySelector('article[data-testid="tweet"]');
  const user = tweet.querySelector('[data-testid="User-Name"]');
  let scans = 0;
  const original = tweet.querySelector;
  tweet.querySelector = (...args) => { scans += 1; return original.call(tweet, ...args); };
  for (let i = 0; i < 100; i += 1) {
    user.append(page.document.createElement('span'));
    page.advanceTime(100);
  }
  assert.equal(scans, 0);
});

test('pauses discovery when hidden or disabled and catches up when re-enabled', async () => {
  const page = createPage('block', { deferTimers: true });
  page.flushTimers();
  await page.setHidden(true);
  assert.equal(page.activeObservers(), 0);
  assert.equal(page.pendingTimerCount(), 0);
  const tweet = page.document.querySelector('article[data-testid="tweet"]');
  tweet.querySelector('.hajb-account-action-btn').remove();
  await page.setHidden(false);
  page.flushTimers();
  assert.ok(tweet.querySelector('.hajb-account-action-btn'));
  page.emitSettingChange('hajbEnabled', false);
  assert.equal(page.activeObservers(), 0);
  page.emitSettingChange('hajbEnabled', true);
  page.flushTimers();
  assert.equal(page.activeObservers(), 1);
});

test('discards detached tweets before pending injection', () => {
  const page = createPage('block', { deferTimers: true });
  const tweet = page.document.querySelector('article[data-testid="tweet"]');
  tweet.remove();
  page.flushTimers();
  assert.equal(tweet.querySelector('.hajb-action-btn'), null);
});

test('large timelines yield between batches and still receive exactly two controls each', () => {
  const page = createPage('block', { deferTimers: true, tweetCount: 1000 });
  page.advanceTime(32);
  const firstBatch = page.document.querySelectorAll('.hajb-action-btn').length;
  assert.ok(firstBatch > 0 && firstBatch <= 40);
  page.flushTimers();
  assert.equal(page.document.querySelectorAll('.hajb-action-btn').length, 2000);
  assert.equal(page.pendingTimerCount(), 0);
});

test('a burst larger than the pending queue is fully recovered without duplicate controls', () => {
  const page = createPage('block', { deferTimers: true });
  page.flushTimers();
  for (let i = 0; i < 600; i += 1) {
    const tweet = page.document.createElement('article');
    tweet.setAttribute('data-testid', 'tweet');
    const caret = page.document.createElement('button');
    caret.setAttribute('data-testid', 'caret');
    tweet.append(caret);
    page.document.body.append(tweet);
  }
  page.flushTimers();
  assert.equal(page.document.querySelectorAll('.hajb-action-btn').length, 1202);
  assert.equal(page.pendingTimerCount(), 0);
});

test('replacing the entire action bar restores controls without retaining the old bar', () => {
  const page = createPage('block', { deferTimers: true });
  page.flushTimers();
  const tweet = page.document.querySelector('article[data-testid="tweet"]');
  tweet.querySelector('.actions').remove();
  const bar = page.document.createElement('div');
  const caret = page.document.createElement('button');
  caret.setAttribute('data-testid', 'caret');
  bar.append(caret);
  tweet.append(bar);
  page.flushTimers();
  assert.equal(tweet.querySelectorAll('.hajb-action-btn').length, 2);
});

test('action buttons enable CSS containment and omit unused hidden override', () => {
  assert.match(contentStyles, /\.hajb-action-btn\s*\{[^}]*contain:\s*layout style paint;/s);
  assert.doesNotMatch(contentStyles, /\.hajb-action-btn\[hidden\]/);
});
