// One Click Block Twitter content script
(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TWEET = 'article[data-testid="tweet"]';
  const BUTTON_CLASS = 'hajb-action-btn';
  const ACCOUNT_BUTTON_CLASS = 'hajb-account-action-btn';
  const NOT_INTERESTED_BUTTON_CLASS = 'hajb-not-interested-btn';
  const BIDI_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
  const WHITESPACE = /\s+/g;
  const SETTING_KEYS = ['actionType', 'hajbEnabled', 'accountActionEnabled', 'notInterestedEnabled'];
  const DEFAULT_SETTINGS = Object.freeze({
    actionType: 'block',
    hajbEnabled: true,
    accountActionEnabled: true,
    notInterestedEnabled: true
  });
  const NON_CONTAINER_TAGS = new Set([
    'SPAN', 'A', 'IMG', 'SVG', 'PATH', 'VIDEO', 'AUDIO', 'BUTTON',
    'INPUT', 'TEXTAREA', 'P', 'TIME', 'BR', 'HR', 'SCRIPT', 'STYLE',
    'LINK', 'META', 'SOURCE', 'TRACK', 'CANVAS', 'IFRAME'
  ]);

  const ACTION_PRESENTATION = Object.freeze({
    block: {
      labels: ['block', 'حظر'],
      messageKey: 'blockButtonLabel',
      svgPath: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z'
    },
    mute: {
      labels: ['mute', 'كتم'],
      messageKey: 'muteButtonLabel',
      svgPath: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zM9.5 9.5h5v2h-5v-2z'
    },
    notInterested: {
      labels: [
        'not interested in this post',
        'not interested in this tweet',
        'غير مهتم بهذا المنشور',
        'غير مهتم بهذه التغريدة',
        'لست مهتمًا بهذا المنشور',
        'لست مهتمًا بهذه التغريدة'
      ],
      messageKey: 'notInterestedButtonLabel',
      svgPath: 'M2.1 3.51 3.51 2.1 21.9 20.49 20.49 21.9l-3.1-3.1A11.7 11.7 0 0 1 12 20C5 20 1 12 1 12a20.3 20.3 0 0 1 4.17-5.41L2.1 3.51zm5.18 5.18A5 5 0 0 0 14.3 15.7l-1.54-1.54a2.5 2.5 0 0 1-2.92-2.92L7.28 8.69zM12 4c7 0 11 8 11 8a20.8 20.8 0 0 1-3.22 4.47l-2.84-2.84A5 5 0 0 0 10.37 7.06L8.1 4.79A11.8 11.8 0 0 1 12 4z'
    }
  });

  const cachedLabels = Object.create(null);
  const cachedIcons = Object.create(null);

  const normalizeStoredActionType = (actionType) => actionType === 'mute' ? 'mute' : 'block';

  const getActionLabel = (actionTypeValue) => {
    if (!cachedLabels[actionTypeValue]) {
      const presentation = ACTION_PRESENTATION[actionTypeValue];
      cachedLabels[actionTypeValue] =
        chrome.i18n.getMessage(presentation.messageKey) ||
        chrome.i18n.getMessage('extName') ||
        'One Click Block Twitter';
    }
    return cachedLabels[actionTypeValue];
  };

  const getActionIconTemplate = (actionTypeValue) => {
    if (!cachedIcons[actionTypeValue]) {
      const presentation = ACTION_PRESENTATION[actionTypeValue];
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '18.75');
      svg.setAttribute('height', '18.75');
      svg.setAttribute('fill', 'currentColor');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', presentation.svgPath);
      svg.appendChild(path);
      cachedIcons[actionTypeValue] = svg;
    }
    return cachedIcons[actionTypeValue];
  };

  const matchesActionText = (textContent, actionType) => {
    const normalizedText = textContent
      .replace(BIDI_MARKS, '')
      .trim()
      .replace(WHITESPACE, ' ')
      .toLocaleLowerCase();

    const presentation = Object.hasOwn(ACTION_PRESENTATION, actionType)
      ? ACTION_PRESENTATION[actionType]
      : ACTION_PRESENTATION.block;
    return presentation.labels.some((label) => (
      normalizedText === label || normalizedText.startsWith(`${label} `) || normalizedText.startsWith(`${label}@`)
    ));
  };

  const applyActionPresentation = (button, actionType) => {
    const actionTypeValue = Object.hasOwn(ACTION_PRESENTATION, actionType) ? actionType : 'block';
    if (button.dataset.actionType === actionTypeValue) return;
    const label = getActionLabel(actionTypeValue);

    button.setAttribute('aria-label', label);
    button.dataset.actionType = actionTypeValue;
    button.title = label;
    button.replaceChildren(getActionIconTemplate(actionTypeValue).cloneNode(true));
  };

  // 1. Storage Manager
  let onStorageReady = () => {};
  let onSettingsChanged = () => {};
  let storageReady = false;
  let settingsDirty = false;

  const Storage = (() => {
    let cachedSettings = { ...DEFAULT_SETTINGS };

    const normalizeSettings = (settings) => {
      const source = settings && typeof settings === 'object' ? settings : DEFAULT_SETTINGS;
      return {
        actionType: normalizeStoredActionType(source.actionType),
        hajbEnabled: source.hajbEnabled !== false,
        accountActionEnabled: source.accountActionEnabled !== false,
        notInterestedEnabled: source.notInterestedEnabled !== false
      };
    };

    chrome.storage.local.get(DEFAULT_SETTINGS, (data) => {
      cachedSettings = normalizeSettings(data);
      storageReady = true;
      onStorageReady();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let relevant = false;
      for (let i = 0; i < SETTING_KEYS.length; i++) {
        if (changes[SETTING_KEYS[i]]) {
          relevant = true;
          break;
        }
      }
      if (!relevant) return;

      const prevSettings = cachedSettings;
      const next = { ...cachedSettings };
      for (let i = 0; i < SETTING_KEYS.length; i++) {
        const key = SETTING_KEYS[i];
        if (changes[key]) next[key] = changes[key].newValue;
      }
      cachedSettings = normalizeSettings(next);

      if (document.hidden) {
        settingsDirty = true;
        return;
      }
      onSettingsChanged(prevSettings, cachedSettings);
    });

    return {
      getSettings: () => cachedSettings
    };
  })();

  // 2. Automation
  const Automation = (() => {
    const getMenuRoot = () => document.getElementById('layers') || document.body;

    const waitForElement = (selector, parent = getMenuRoot(), timeout = 2000) => {
      return new Promise((resolve) => {
        const el = parent.querySelector(selector);
        if (el) return resolve(el);
        let timeoutId = null;
        const finish = (found) => {
          observer.disconnect();
          if (timeoutId !== null) clearTimeout(timeoutId);
          resolve(found);
        };
        const observer = new MutationObserver(() => {
          const found = parent.querySelector(selector);
          if (found) finish(found);
        });
        observer.observe(parent, { childList: true, subtree: true });
        timeoutId = setTimeout(() => finish(null), timeout);
      });
    };

    const executeAction = async (caretElement, actionType) => {
      const menuRoot = getMenuRoot();
      try {
        caretElement.click();

        const menu = await waitForElement('[data-testid="Dropdown"]', menuRoot, 1000);
        if (!menu) throw new Error('Menu not found');

        const menuItems = menu.querySelectorAll('[role="menuitem"]');
        let targetItem = null;

        for (const item of menuItems) {
          if (matchesActionText(item.textContent, actionType)) {
            targetItem = item;
            break;
          }
        }

        if (!targetItem) throw new Error(`${actionType} option not found`);
        targetItem.click();

        if (actionType === 'block') {
          const confirmSheet = await waitForElement('[data-testid="confirmationSheetDialog"]', menuRoot, 1000);
          if (!confirmSheet) throw new Error('Confirmation sheet not found');

          const buttons = confirmSheet.querySelectorAll('[role="button"]');
          let confirmBtn = null;
          for (const btn of buttons) {
            if (matchesActionText(btn.textContent, 'block')) {
              confirmBtn = btn;
              break;
            }
          }

          if (!confirmBtn) throw new Error('Confirm button not found');
          confirmBtn.click();
        }

        return true;
      } catch (err) {
        console.error(`[One Click Block Twitter] Action failed: ${err.message}`);
        const menu = menuRoot.querySelector('[data-testid="Dropdown"]');
        if (menu) document.body.click();
        return false;
      }
    };

    return { executeAction };
  })();

  // 3. Mutator & Event Delegation
  const Mutator = (() => {
    let controls = new WeakMap();
    let actionInFlight = false;

    const findBarButton = (bar, roleClass) => {
      const children = bar.children;
      for (let i = 0; i < children.length; i++) {
        if (children[i].classList?.contains(roleClass)) return children[i];
      }
      return null;
    };

    const hasIntactControls = (tweet, settings = Storage.getSettings()) => {
      const cached = controls.get(tweet);
      if (!cached) return false;
      const { caret, parent, account, dismiss } = cached;
      if (!caret.isConnected || caret.parentElement !== parent || !tweet.contains(caret)) return false;

      const needAccount = settings.hajbEnabled && settings.accountActionEnabled;
      const needDismiss = settings.hajbEnabled && settings.notInterestedEnabled;

      if (needAccount) {
        if (!account || account.parentElement !== parent || account.dataset.actionType !== settings.actionType) {
          return false;
        }
      } else if (account) {
        return false;
      }

      if (needDismiss) {
        if (!dismiss || dismiss.parentElement !== parent) return false;
      } else if (dismiss) {
        return false;
      }

      return true;
    };

    const createActionButton = (actionType, roleClass) => {
      const btn = document.createElement('button');
      btn.className = `${BUTTON_CLASS} ${roleClass}`;
      btn.setAttribute('type', 'button');
      applyActionPresentation(btn, actionType);
      return btn;
    };

    const injectTweetButtons = (tweets) => {
      const settings = Storage.getSettings();
      const needAccount = settings.hajbEnabled && settings.accountActionEnabled;
      const needDismiss = settings.hajbEnabled && settings.notInterestedEnabled;
      if (!needAccount && !needDismiss) return;

      for (let i = 0; i < tweets.length; i++) {
        const tweet = tweets[i];
        if (!tweet.isConnected || hasIntactControls(tweet, settings)) continue;
        const caret = tweet.querySelector('[data-testid="caret"]');
        const bar = caret?.parentElement;
        if (!bar) continue;

        let accountButton = findBarButton(bar, ACCOUNT_BUTTON_CLASS);
        let notInterestedButton = findBarButton(bar, NOT_INTERESTED_BUTTON_CLASS);

        if (needAccount) {
          if (!accountButton) {
            accountButton = createActionButton(settings.actionType, ACCOUNT_BUTTON_CLASS);
            bar.insertBefore(accountButton, notInterestedButton ?? caret);
          } else {
            applyActionPresentation(accountButton, settings.actionType);
          }
        } else if (accountButton) {
          accountButton.remove();
          accountButton = null;
        }

        if (needDismiss) {
          if (!notInterestedButton) {
            notInterestedButton = createActionButton('notInterested', NOT_INTERESTED_BUTTON_CLASS);
            bar.insertBefore(notInterestedButton, caret);
          }
        } else if (notInterestedButton) {
          notInterestedButton.remove();
          notInterestedButton = null;
        }

        controls.set(tweet, {
          caret,
          parent: bar,
          account: accountButton,
          dismiss: notInterestedButton
        });
      }
    };

    const removeButtonsByClass = (roleClass, cacheField) => {
      const buttons = document.querySelectorAll(`.${roleClass}`);
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        const tweet = btn.closest(TWEET);
        const cached = tweet && controls.get(tweet);
        if (cached) cached[cacheField] = null;
        btn.remove();
      }
    };

    const reconcileButtons = (settings) => {
      const needAccount = settings.hajbEnabled && settings.accountActionEnabled;
      const needDismiss = settings.hajbEnabled && settings.notInterestedEnabled;

      if (!needAccount && !needDismiss) {
        const buttons = document.querySelectorAll(`.${BUTTON_CLASS}`);
        for (let i = 0; i < buttons.length; i++) buttons[i].remove();
        controls = new WeakMap();
        return false;
      }

      if (needAccount) {
        const buttons = document.querySelectorAll(`.${ACCOUNT_BUTTON_CLASS}`);
        for (let i = 0; i < buttons.length; i++) {
          applyActionPresentation(buttons[i], settings.actionType);
        }
      } else {
        removeButtonsByClass(ACCOUNT_BUTTON_CLASS, 'account');
      }

      if (!needDismiss) {
        removeButtonsByClass(NOT_INTERESTED_BUTTON_CLASS, 'dismiss');
      }

      return true;
    };

    document.body.addEventListener('click', async (e) => {
      const btn = e.target?.closest?.(`.${BUTTON_CLASS}`);
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();
      if (actionInFlight) return;

      const tweet = btn.closest(TWEET);
      if (!tweet) return;

      const cachedCaret = controls.get(tweet)?.caret;
      const caret = (cachedCaret && cachedCaret.isConnected && tweet.contains(cachedCaret))
        ? cachedCaret
        : (btn.parentElement?.querySelector('[data-testid="caret"]') ?? tweet.querySelector('[data-testid="caret"]'));
      if (!caret) return;

      const settings = Storage.getSettings();
      const actionType = btn.dataset.actionType === 'notInterested'
        ? 'notInterested'
        : settings.actionType;
      const previousStyles = {
        opacity: tweet.style.opacity,
        pointerEvents: tweet.style.pointerEvents
      };

      actionInFlight = true;
      tweet.style.opacity = '0.3';
      tweet.style.pointerEvents = 'none';

      try {
        const success = await Automation.executeAction(caret, actionType);
        if (success) {
          tweet.style.display = 'none';
        } else {
          tweet.style.opacity = previousStyles.opacity;
          tweet.style.pointerEvents = previousStyles.pointerEvents;
        }
      } finally {
        actionInFlight = false;
      }
    });

    return { injectTweetButtons, hasIntactControls, reconcileButtons };
  })();

  // 4. Observer
  const Observer = (() => {
    let observer = null;
    let timer = null;
    let active = false;
    const pendingTweets = new Set();
    let scan = null;
    let needsScan = false;

    const getObserveTarget = () => document.getElementById('react-root') || document.body;

    const enabled = () => {
      const settings = Storage.getSettings();
      return !document.hidden && settings.hajbEnabled &&
        (settings.accountActionEnabled || settings.notInterestedEnabled);
    };

    const isOnlyOwnButtons = (nodes) => {
      if (!nodes || !nodes.length) return false;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.nodeType !== 1 || !node.classList?.contains(BUTTON_CLASS)) return false;
      }
      return true;
    };

    const hasElementNode = (nodes) => {
      if (!nodes || !nodes.length) return false;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].nodeType === 1) return true;
      }
      return false;
    };

    const isInsideOwnButton = (node) => {
      let current = node;
      for (let depth = 0; depth < 3 && current; depth++) {
        if (current.nodeType === 1 && current.classList?.contains(BUTTON_CLASS)) return true;
        current = current.parentElement;
      }
      return false;
    };

    const schedule = () => {
      if (timer !== null || !active) return;
      timer = -1;
      const id = setTimeout(() => { timer = null; flush(); }, 32);
      if (timer === -1) timer = id;
    };

    const flush = () => {
      if (!active) return;
      const settings = Storage.getSettings();
      if (needsScan && !scan) {
        needsScan = false;
        scan = getObserveTarget().querySelectorAll(TWEET)[Symbol.iterator]();
      }
      const batch = [];
      while (batch.length < 20) {
        let tweet;
        if (pendingTweets.size) {
          tweet = pendingTweets.values().next().value;
          pendingTweets.delete(tweet);
        } else if (scan) {
          const next = scan.next();
          if (next.done) { scan = null; break; }
          tweet = next.value;
        } else {
          break;
        }
        if (tweet.isConnected && !Mutator.hasIntactControls(tweet, settings)) {
          batch.push(tweet);
        }
      }
      if (batch.length) Mutator.injectTweetButtons(batch);
      if (pendingTweets.size || scan || needsScan) schedule();
    };

    const collect = (tweet, settings) => {
      if (!tweet || Mutator.hasIntactControls(tweet, settings)) return;
      if (pendingTweets.size < 256) pendingTweets.add(tweet);
      else needsScan = true;
    };

    const handleMutations = (mutations) => {
      if (!active) return;
      const settings = Storage.getSettings();
      const seenTargets = mutations.length > 1 ? new Map() : null;

      for (let i = 0; i < mutations.length; i++) {
        const mutation = mutations[i];
        const added = mutation.addedNodes;
        const removed = mutation.removedNodes;
        const hasAdded = added && added.length > 0;
        const hasRemoved = removed && removed.length > 0;

        if (hasAdded && !hasRemoved && isOnlyOwnButtons(added)) continue;
        if (!hasAdded && !hasElementNode(removed)) continue;

        const target = mutation.target;
        if (target && target.nodeType === 1 && isInsideOwnButton(target)) continue;

        let insideTweet = false;
        if (target && target.nodeType === 1) {
          if (seenTargets && seenTargets.has(target)) {
            insideTweet = seenTargets.get(target);
          } else {
            const tweet = target.closest?.(TWEET);
            insideTweet = Boolean(tweet);
            if (seenTargets) seenTargets.set(target, insideTweet);
            if (tweet) collect(tweet, settings);
          }
        }
        if (insideTweet || !hasAdded) continue;

        for (let j = 0; j < added.length; j++) {
          const node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.matches?.(TWEET)) {
            collect(node, settings);
          } else if (!NON_CONTAINER_TAGS.has(node.tagName) && node.children?.length) {
            const tweets = node.querySelectorAll?.(TWEET);
            if (tweets) {
              for (let k = 0; k < tweets.length; k++) collect(tweets[k], settings);
            }
          }
        }
      }
      if (pendingTweets.size || needsScan) schedule();
    };

    const stop = () => {
      active = false;
      observer?.disconnect();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pendingTweets.clear();
      scan = null;
      needsScan = false;
    };

    const sync = (forceScan = false) => {
      if (!enabled()) { stop(); return; }
      if (!active) {
        active = true;
        needsScan = true;
        observer.observe(getObserveTarget(), { childList: true, subtree: true });
        schedule();
        return;
      }
      if (forceScan) {
        needsScan = true;
        schedule();
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }
      let forceScan = false;
      if (settingsDirty) {
        settingsDirty = false;
        forceScan = Mutator.reconcileButtons(Storage.getSettings());
      }
      sync(forceScan);
    };

    const handleSettingsChange = (prevSettings, nextSettings) => {
      const prevAccount = prevSettings.hajbEnabled && prevSettings.accountActionEnabled;
      const prevDismiss = prevSettings.hajbEnabled && prevSettings.notInterestedEnabled;
      const nextAccount = nextSettings.hajbEnabled && nextSettings.accountActionEnabled;
      const nextDismiss = nextSettings.hajbEnabled && nextSettings.notInterestedEnabled;

      Mutator.reconcileButtons(nextSettings);
      const newlyEnabled = (nextAccount && !prevAccount) || (nextDismiss && !prevDismiss);
      sync(newlyEnabled);
    };

    const start = () => {
      if (observer) return;
      observer = new MutationObserver(handleMutations);
      onSettingsChanged = handleSettingsChange;
      document.addEventListener('visibilitychange', handleVisibility);
      globalThis.addEventListener?.('pagehide', stop);
      globalThis.addEventListener?.('pageshow', handleVisibility);
      sync();
    };

    return { start };
  })();

  const maybeStart = () => {
    if (!storageReady || document.readyState === 'loading') return;
    Observer.start();
  };

  onStorageReady = maybeStart;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeStart);
  } else {
    maybeStart();
  }
})();
