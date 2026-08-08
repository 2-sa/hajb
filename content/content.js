// HAJB Content Script

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
  const presentation = ACTION_PRESENTATION[actionTypeValue];
  const label = chrome.i18n.getMessage(presentation.messageKey) || chrome.i18n.getMessage('extName') || 'HAJB';

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
  info: (msg, ...args) => console.log(`[HAJB] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[HAJB] ${msg}`, ...args)
};

// 2. Storage Manager
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
  });

  // Listen for popup changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    for (const key of ['actionType', 'hajbEnabled', 'accountActionEnabled', 'notInterestedEnabled']) {
      if (changes[key]) cachedSettings[key] = changes[key].newValue;
    }
    cachedSettings = normalizeSettings(cachedSettings);
    updateInjectedButtons(cachedSettings);
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

      const observer = new MutationObserver(() => {
        const found = parent.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(parent, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
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

  return { injectTweetButtons };
})();

// 5. Observer
const Observer = (() => {
  let observer = null;
  let debounceTimer = null;
  let pendingTweets = new Set();

  const handleMutations = (mutations) => {
    const collectContainingTweet = (node) => {
      if (!node || typeof node.closest !== 'function') return;

      const parentTweet = node.closest('article[data-testid="tweet"]');
      if (parentTweet) pendingTweets.add(parentTweet);
    };

    const collectAddedTweets = (node) => {
      collectContainingTweet(node);

      if (typeof node.querySelectorAll === 'function') {
        node.querySelectorAll('article[data-testid="tweet"]').forEach((tweet) => pendingTweets.add(tweet));
      }
    };

    for (const mutation of mutations) {
      collectContainingTweet(mutation.target);
      mutation.addedNodes.forEach(collectAddedTweets);
    }

    if (pendingTweets.size > 0) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const tweetsToUpdate = pendingTweets;
        pendingTweets = new Set();
        Mutator.injectTweetButtons(tweetsToUpdate);
      }, 100); 
    }
  };

  const start = () => {
    if (observer) return;
    setTimeout(() => {
      const tweets = document.querySelectorAll('article[data-testid="tweet"]');
      if (tweets.length > 0) Mutator.injectTweetButtons(tweets);
    }, 500);

    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { childList: true, subtree: true });
    Logger.info('Observer started with event delegation');
  };

  return { start };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', Observer.start);
} else {
  Observer.start();
}
