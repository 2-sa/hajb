# HAJB Engineering Context

> **Note to future maintainers:** Read this file before modifying the extension. It explains the performance and stability constraints behind HAJB's implementation.

## Core Philosophy
HAJB is designed to make blocking or muting an X account feel immediate. Performance, memory efficiency, predictable targeting, and clear visual feedback are the highest priorities.

## Critical Architectural Decisions

### 1. The React Unmount Bug (Why we don't use `display: none` initially)
**DO NOT change `opacity: 0.3` to `display: none` prior to the action execution.**
Twitter is a React SPA. If you apply `display: none` to a tweet container, React immediately unmounts it from the Virtual DOM. This causes the internal dropdown menu (which we need to interact with via DOM automation) to vanish or fail to render. 
**Solution:** We apply `opacity: 0.3` and `pointer-events: none` during the execution phase to give the user visual feedback without unmounting the DOM. Once the action succeeds, we apply `display: none` for complete removal.

### 2. Event Delegation (Memory Leak Prevention)
**DO NOT attach `addEventListener` to individual injected buttons.**
Twitter uses an infinite scroll mechanism. Injecting thousands of buttons with individual event listeners causes severe memory bloat and browser lag.
**Solution:** We use a single, global event listener attached to `document.body` that intercepts clicks using `e.target.closest('.hajb-action-btn')`.

### 3. Synchronous Settings Caching (I/O Optimization)
**DO NOT use `await chrome.storage.local.get` inside the `MutationObserver` or scroll events.**
Reading from Chrome's database is an asynchronous I/O operation. Doing this during a rapid mutation event freezes the browser.
**Solution:** `Storage Manager` loads the settings once into a local variable and keeps it updated via `chrome.storage.onChanged`. The rest of the app reads this variable synchronously and instantly.

### 4. Smart Multi-Language DOM Matching (i18n Bypass)
**DO NOT fetch `messages.json` dynamically inside `content.js`.**
Waiting for an asynchronous `fetch` for translations delays the button execution.
**Solution:** The script matches normalized English and Arabic action prefixes in the X DOM. Prefix matching deliberately rejects inverse actions such as `Unmute` and `إلغاء الكتم`. This avoids async locale-file loading while supporting X interfaces in English and Arabic.

### 5. Content Security Policy (MV3 CSP Compliance)
**DO NOT inject remote scripts, stylesheets, or fonts (e.g., Google Fonts).**
Manifest V3 strictly blocks remote code execution. `popup.css` deliberately uses `system-ui, -apple-system` native fonts to ensure 100% compliance and instant rendering without network requests.

### 6. Precise Target Extraction
**DO NOT use regex on the tweet's raw text to find the `@` handle.**
Tweets can mention other users. To prevent blocking an innocent mentioned user, `Automation.extractScreenName` strictly queries the `a[role="link"]` inside the specific `[data-testid="User-Name"]` block.

### 7. Targeted React Re-injection
**DO NOT rescan every tweet after every DOM mutation.**
Twitter can replace a tweet's action bar while retaining the article element, which removes injected controls. The mutation handler therefore inspects only the mutation target and newly added subtree, then re-injects the button into affected tweets when it is actually missing.

### 8. Settings Presentation Consistency
The cached setting is the source of truth for both execution and presentation. Initial storage reads and subsequent `storage.onChanged` events must update already-injected buttons so the visible icon and accessible label always match the action that will execute.

---
**Summary for AI:** Maintain the zero-latency philosophy. If you add features, ensure they are O(1) in complexity during scroll events and do not rely on asynchronous I/O unless absolutely necessary.
