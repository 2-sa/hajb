// OCB Content Script (Bundled Native) - Enterprise Level

// 1. Logger
const Logger = {
  info: (msg, ...args) => console.log(`[OCB] 🛡️ ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[OCB] ❌ ${msg}`, ...args)
};

// 2. Storage Manager
const Storage = (() => {
  let cachedSettings = { actionType: 'block' };

  // Init sync
  chrome.storage.local.get(cachedSettings, (data) => {
    cachedSettings = data;
  });

  // Listen for popup changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.actionType) {
      cachedSettings.actionType = changes.actionType.newValue;
    }
  });

  const getSettings = () => cachedSettings; // Now synchronous and instant
  return { getSettings };
})();

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

  const executeAction = async (tweetElement, caretElement, settings) => {
    try {
      const username = extractScreenName(tweetElement);
      Logger.info(`Executing ${settings.actionType} on ${username}`);
      
      caretElement.click();

      const menu = await waitForElement('[data-testid="Dropdown"]', document.body, 1000);
      if (!menu) throw new Error("Menu not found");

      const isBlock = settings.actionType === 'block';
      const menuItems = menu.querySelectorAll('[role="menuitem"]');
      let targetItem = null;

      // Smart DOM matching for both EN and AR regardless of extension language
      for (const item of menuItems) {
        if (item.textContent.includes(isBlock ? 'Block' : 'Mute') || 
            item.textContent.includes(isBlock ? 'حظر' : 'كتم')) {
          targetItem = item;
          break;
        }
      }

      if (!targetItem) throw new Error(`${settings.actionType} option not found`);
      targetItem.click();

      if (isBlock) {
        const confirmSheet = await waitForElement('[data-testid="confirmationSheetDialog"]', document.body, 1000);
        if (!confirmSheet) throw new Error("Confirmation sheet not found");

        const buttons = confirmSheet.querySelectorAll('[role="button"]');
        let confirmBtn = null;
        for (const btn of buttons) {
          if (btn.textContent.includes('Block') || btn.textContent.includes('حظر')) {
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
  const BUTTON_CLASS = 'ocb-action-btn';

  const createActionButton = (actionType) => {
    const btn = document.createElement('div');
    btn.className = BUTTON_CLASS;
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    
    // Shield with slash (block) or bell with slash (mute)
    const svgPath = actionType === 'block' 
      ? 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z'
      : 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zM9.5 9.5h5v2h-5v-2z';

    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18.75" height="18.75" fill="currentColor"><path d="${svgPath}"></path></svg>`;
    btn.title = chrome.i18n.getMessage("extName") || "One-Click Block";

    return btn;
  };

  const injectTweetButtons = (tweets) => {
    const settings = Storage.getSettings();
    
    tweets.forEach(tweet => {
      if (tweet.dataset.ocbInjected === 'true') return;

      const caret = tweet.querySelector('[data-testid="caret"]');
      if (!caret) return;
      
      tweet.dataset.ocbInjected = 'true';
      const btn = createActionButton(settings.actionType);
      caret.parentElement.insertBefore(btn, caret);
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
    
    // ENTERPRISE UPGRADE: Use opacity during execution to prevent React Unmount bug, then display none
    tweet.style.opacity = '0.3';
    tweet.style.pointerEvents = 'none';

    const success = await Automation.executeAction(tweet, caret, settings);
    if (success) {
      tweet.style.display = 'none';
    } else {
      tweet.style.opacity = '1';
      tweet.style.pointerEvents = 'auto';
    }
  });

  return { injectTweetButtons };
})();

// 5. Observer
const Observer = (() => {
  let observer = null;
  let debounceTimer = null;

  const handleMutations = (mutations) => {
    let shouldUpdate = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldUpdate = true;
        break;
      }
    }

    if (shouldUpdate) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const tweets = document.querySelectorAll('article[data-testid="tweet"]:not([data-ocb-injected="true"])');
        if (tweets.length > 0) {
          Mutator.injectTweetButtons(tweets);
        }
      }, 100); 
    }
  };

  const start = () => {
    if (observer) return;
    setTimeout(() => {
      const tweets = document.querySelectorAll('article[data-testid="tweet"]:not([data-ocb-injected="true"])');
      if (tweets.length > 0) Mutator.injectTweetButtons(tweets);
    }, 500);

    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { childList: true, subtree: true });
    Logger.info('Enterprise Observer started with Event Delegation');
  };

  return { start };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', Observer.start);
} else {
  Observer.start();
}
