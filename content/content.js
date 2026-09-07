// One Click Block Twitter content script

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

const normalizeStoredActionType = (actionType) => actionType === 'mute' ? 'mute' : 'block';

const matchesActionText = (textContent, actionType) => {
  const normalizedText = textContent
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gi, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();

  const presentation = ACTION_PRESENTATION[actionType] ?? ACTION_PRESENTATION.block;
  return presentation.labels.some((label) => (
    normalizedText === label || normalizedText.startsWith(`${label} `) || normalizedText.startsWith(`${label}@`)
  ));
};

const applyActionPresentation = (button, actionType) => {
  const actionTypeValue = ACTION_PRESENTATION[actionType] ? actionType : 'block';
  if (button.dataset.actionType === actionTypeValue) return;
  const presentation = ACTION_PRESENTATION[actionTypeValue];
  const label = chrome.i18n.getMessage(presentation.messageKey) || chrome.i18n.getMessage('extName') || 'One Click Block Twitter';

  button.setAttribute('aria-label', label);
  button.dataset.actionType = actionTypeValue;
  button.title = label;
  button.innerHTML = `<svg viewBox="0 0 24 24" width="18.75" height="18.75" fill="currentColor" aria-hidden="true"><path d="${presentation.svgPath}"></path></svg>`;
};

const updateInjectedButtons = (settings) => {
  document.querySelectorAll('.hajb-account-action-btn').forEach((button) => {
    applyActionPresentation(button, settings.actionType);
    button.hidden = !settings.hajbEnabled || !settings.accountActionEnabled;
  });
  document.querySelectorAll('.hajb-not-interested-btn').forEach((button) => {
    button.hidden = !settings.hajbEnabled || !settings.notInterestedEnabled;
  });
};

// 1. Logger
const Logger = {
  info: (msg, ...args) => console.log(`[One Click Block Twitter] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[One Click Block Twitter] ${msg}`, ...args)
};

// 2. Storage Manager
let onSettingsUpdated = () => {};
const Storage = (() => {
  let cachedSettings = {
    actionType: 'block',
    hajbEnabled: true,
    accountActionEnabled: true,
    notInterestedEnabled: true
  };

  const normalizeSettings = (settings) => ({
    actionType: normalizeStoredActionType(settings.actionType),
    hajbEnabled: settings.hajbEnabled !== false,
    accountActionEnabled: settings.accountActionEnabled !== false,
    notInterestedEnabled: settings.notInterestedEnabled !== false
  });

  // Init sync
  chrome.storage.local.get(cachedSettings, (data) => {
    cachedSettings = normalizeSettings(data);
    updateInjectedButtons(cachedSettings);
    onSettingsUpdated();
  });

  // Listen for popup changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!['actionType', 'hajbEnabled', 'accountActionEnabled', 'notInterestedEnabled'].some((key) => changes[key])) return;

    for (const key of ['actionType', 'hajbEnabled', 'accountActionEnabled', 'notInterestedEnabled']) {
      if (changes[key]) cachedSettings[key] = changes[key].newValue;
    }
    cachedSettings = normalizeSettings(cachedSettings);
    updateInjectedButtons(cachedSettings);
    onSettingsUpdated();
  });

  const getSettings = () => cachedSettings; // Now synchronous and instant
  return { getSettings };
})();

const recordSuccessfulAction = (actionType) => {
  const response = chrome.runtime?.sendMessage?.({
    type: 'HAJB_RECORD_ACTION',
    actionType
  });
  response?.catch?.((error) => Logger.error(`Stats update failed: ${error.message}`));
};

// 3. Automation
const Automation = (() => {
  const waitForElement = async (selector, parent = document.body, timeout = 2000) => {
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

  const extractScreenName = (tweetElement) => {
    const userBlock = tweetElement.querySelector('[data-testid="User-Name"]');
    if (userBlock) {
       const links = userBlock.querySelectorAll('a[role="link"]');
       for (const link of links) {
         if (link.textContent.startsWith('@')) {
           return link.textContent;
         }
       }
    }
    return 'Unknown';
  };

  const executeAction = async (tweetElement, caretElement, actionType) => {
    try {
      const username = extractScreenName(tweetElement);
      Logger.info(`Executing ${actionType} on ${username}`);
      
      caretElement.click();

      const menu = await waitForElement('[data-testid="Dropdown"]', document.body, 1000);
      if (!menu) throw new Error("Menu not found");

      const menuItems = menu.querySelectorAll('[role="menuitem"]');
      let targetItem = null;

      // Smart DOM matching for both EN and AR regardless of extension language
      for (const item of menuItems) {
        if (matchesActionText(item.textContent, actionType)) {
          targetItem = item;
          break;
        }
      }

      if (!targetItem) throw new Error(`${actionType} option not found`);
      targetItem.click();

      if (actionType === 'block') {
        const confirmSheet = await waitForElement('[data-testid="confirmationSheetDialog"]', document.body, 1000);
        if (!confirmSheet) throw new Error("Confirmation sheet not found");

        const buttons = confirmSheet.querySelectorAll('[role="button"]');
        let confirmBtn = null;
        for (const btn of buttons) {
          if (matchesActionText(btn.textContent, 'block')) {
            confirmBtn = btn;
            break;
          }
        }
        
        if (!confirmBtn) throw new Error("Confirm button not found");
        confirmBtn.click();
      }

      return true;

    } catch (err) {
      Logger.error(`Action failed: ${err.message}`);
      // Close dropdown if stuck open
      const menu = document.querySelector('[data-testid="Dropdown"]');
      if (menu) document.body.click(); 
      return false;
    }
  };

  return { executeAction };
})();

// 4. Mutator & Event Delegation
const Mutator = (() => {
  // Weak keys do not keep tweets removed by X alive.
  const controls = new WeakMap();
  const hasIntactControls = (tweet) => {
    const cached = controls.get(tweet);
    return cached && tweet.contains(cached.caret) &&
      cached.caret.parentElement === cached.account.parentElement &&
      cached.caret.parentElement === cached.dismiss.parentElement;
  };
  const BUTTON_CLASS = 'hajb-action-btn';
  const ACCOUNT_BUTTON_CLASS = 'hajb-account-action-btn';
  const NOT_INTERESTED_BUTTON_CLASS = 'hajb-not-interested-btn';

  const createActionButton = (actionType, roleClass) => {
    const btn = document.createElement('button');
    btn.className = `${BUTTON_CLASS} ${roleClass}`;
    btn.setAttribute('type', 'button');
    applyActionPresentation(btn, actionType);

    return btn;
  };

  const injectTweetButtons = (tweets) => {
    const settings = Storage.getSettings();
    
    tweets.forEach(tweet => {
      if (!document.body.contains(tweet) || hasIntactControls(tweet)) return;
      const caret = tweet.querySelector('[data-testid="caret"]');
      if (!caret?.parentElement) return;

      let accountButton = tweet.querySelector(`.${ACCOUNT_BUTTON_CLASS}`);
      let notInterestedButton = tweet.querySelector(`.${NOT_INTERESTED_BUTTON_CLASS}`);

      if (!accountButton) {
        accountButton = createActionButton(settings.actionType, ACCOUNT_BUTTON_CLASS);
        caret.parentElement.insertBefore(accountButton, notInterestedButton ?? caret);
      }
      accountButton.hidden = !settings.hajbEnabled || !settings.accountActionEnabled;

      if (!notInterestedButton) {
        notInterestedButton = createActionButton('notInterested', NOT_INTERESTED_BUTTON_CLASS);
        caret.parentElement.insertBefore(notInterestedButton, caret);
      }
      notInterestedButton.hidden = !settings.hajbEnabled || !settings.notInterestedEnabled;
      controls.set(tweet, { caret, account: accountButton, dismiss: notInterestedButton });
    });
  };

  // ENTERPRISE UPGRADE: Global Event Delegation to prevent memory leaks on infinite scroll
  document.body.addEventListener('click', async (e) => {
    const btn = e.target.closest(`.${BUTTON_CLASS}`);
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const tweet = btn.closest('article[data-testid="tweet"]');
    const caret = tweet?.querySelector('[data-testid="caret"]');
    if (!tweet || !caret) return;

    const settings = Storage.getSettings();
    const actionType = btn.dataset.actionType === 'notInterested'
      ? 'notInterested'
      : settings.actionType;
    const previousStyles = {
      opacity: tweet.style.opacity,
      pointerEvents: tweet.style.pointerEvents
    };
    
    // ENTERPRISE UPGRADE: Use opacity during execution to prevent React Unmount bug, then display none
    tweet.style.opacity = '0.3';
    tweet.style.pointerEvents = 'none';

    const success = await Automation.executeAction(tweet, caret, actionType);
    if (success) {
      recordSuccessfulAction(actionType);
      tweet.style.display = 'none';
    } else {
      tweet.style.opacity = previousStyles.opacity;
      tweet.style.pointerEvents = previousStyles.pointerEvents;
    }
  });

  return { injectTweetButtons, hasIntactControls };
})();

// 5. Observer
const Observer = (() => {
  let observer = null;
  let timer = null;
  let active = false;
  const pendingTweets = new Set();
  let scan = null;
  let needsScan = false;
  const TWEET = 'article[data-testid="tweet"]';
  const enabled = () => {
    const settings = Storage.getSettings();
    return !document.hidden && settings.hajbEnabled &&
      (settings.accountActionEnabled || settings.notInterestedEnabled);
  };

  const schedule = () => {
    if (timer !== null || !active) return;
    // Set a sentinel first; also supports synchronous timer test harnesses.
    timer = -1;
    const id = setTimeout(() => { timer = null; flush(); }, 32);
    if (timer === -1) timer = id;
  };

  const flush = () => {
    if (!active) return;
    if (needsScan && !scan) {
      needsScan = false;
      scan = document.querySelectorAll(TWEET)[Symbol.iterator]();
    }
    const batch = [];
    // Bound DOM work per task so large timelines yield to input and painting.
    for (let count = 0; count < 20; count++) {
      let tweet;
      if (pendingTweets.size) {
        tweet = pendingTweets.values().next().value;
        pendingTweets.delete(tweet);
      } else if (scan) {
        const next = scan.next();
        if (next.done) { scan = null; break; }
        tweet = next.value;
      } else break;
      if (document.body.contains(tweet) && !Mutator.hasIntactControls(tweet)) batch.push(tweet);
    }
    Mutator.injectTweetButtons(batch);
    if (pendingTweets.size || scan || needsScan) schedule();
  };

  const collect = (tweet) => {
    if (!tweet || Mutator.hasIntactControls(tweet)) return;
    if (pendingTweets.size < 256) pendingTweets.add(tweet);
    else needsScan = true;
  };

  const handleMutations = (mutations) => {
    if (!active) return;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length && !mutation.removedNodes?.length &&
          Array.from(mutation.addedNodes).every((node) => node.matches?.('.hajb-action-btn'))) continue;
      const target = mutation.target;
      if (target.closest?.('.hajb-action-btn')) continue;
      const tweet = target.closest?.(TWEET);
      if (tweet) { collect(tweet); continue; }
      for (const node of mutation.addedNodes) {
        if (node.matches?.(TWEET)) collect(node);
        else if (node.querySelectorAll && node.children.length) {
          node.querySelectorAll(TWEET).forEach(collect);
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
  const sync = () => {
    if (!enabled()) { stop(); return; }
    if (active) return;
    active = true;
    needsScan = true;
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  };
  const start = () => {
    if (observer) return;
    observer = new MutationObserver(handleMutations);
    onSettingsUpdated = sync;
    document.addEventListener('visibilitychange', sync);
    globalThis.addEventListener?.('pagehide', stop);
    globalThis.addEventListener?.('pageshow', sync);
    sync();
  };

  return { start };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', Observer.start);
} else {
  Observer.start();
}
