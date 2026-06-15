# AI Context & Architecture Guide 🤖

> **Note to Future AI / LLMs:** If you are asked to modify, debug, or extend this Chrome Extension, **READ THIS FILE FIRST**. It contains critical context about why certain unconventional approaches were taken to ensure Enterprise-level performance and stability.

## Core Philosophy
This extension is designed to be a "Zero-Latency" tool for blocking/muting users on Twitter (X). Performance, memory efficiency, and immediate visual feedback are the highest priorities.

## Critical Architectural Decisions

### 1. The React Unmount Bug (Why we don't use `display: none` initially)
**DO NOT change `opacity: 0.3` to `display: none` prior to the action execution.**
Twitter is a React SPA. If you apply `display: none` to a tweet container, React immediately unmounts it from the Virtual DOM. This causes the internal dropdown menu (which we need to interact with via DOM automation) to vanish or fail to render. 
**Solution:** We apply `opacity: 0.3` and `pointer-events: none` during the execution phase to give the user visual feedback without unmounting the DOM. Once the action succeeds, we apply `display: none` for complete removal.

### 2. Event Delegation (Memory Leak Prevention)
**DO NOT attach `addEventListener` to individual injected buttons.**
Twitter uses an infinite scroll mechanism. Injecting thousands of buttons with individual event listeners causes severe memory bloat and browser lag.
**Solution:** We use a single, global event listener attached to `document.body` that intercepts clicks using `e.target.closest('.ocb-action-btn')`.

### 3. Synchronous Settings Caching (I/O Optimization)
**DO NOT use `await chrome.storage.local.get` inside the `MutationObserver` or scroll events.**
Reading from Chrome's database is an asynchronous I/O operation. Doing this during a rapid mutation event freezes the browser.
**Solution:** `Storage Manager` loads the settings once into a local variable and keeps it updated via `chrome.storage.onChanged`. The rest of the app reads this variable synchronously and instantly.

### 4. Smart Multi-Language DOM Matching (i18n Bypass)
**DO NOT fetch `messages.json` dynamically inside `content.js`.**
Waiting for an asynchronous `fetch` for translations delays the button execution.
**Solution:** The script is hardcoded to look for both English and Arabic keywords simultaneously in the Twitter DOM (`item.textContent.includes('Block') || item.textContent.includes('حظر')`). This bypasses the need for async translation files in the content script and makes it bulletproof regardless of the user's browser language.

### 5. Content Security Policy (MV3 CSP Compliance)
**DO NOT inject remote scripts, stylesheets, or fonts (e.g., Google Fonts).**
Manifest V3 strictly blocks remote code execution. `popup.css` deliberately uses `system-ui, -apple-system` native fonts to ensure 100% compliance and instant rendering without network requests.

### 6. Precise Target Extraction
**DO NOT use regex on the tweet's raw text to find the `@` handle.**
Tweets can mention other users. To prevent blocking an innocent mentioned user, `Automation.extractScreenName` strictly queries the `a[role="link"]` inside the specific `[data-testid="User-Name"]` block.

---
**Summary for AI:** Maintain the zero-latency philosophy. If you add features, ensure they are O(1) in complexity during scroll events and do not rely on asynchronous I/O unless absolutely necessary.
