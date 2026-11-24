# One Click Block for X / Twitter Engineering Context

> **Note to future maintainers:** Read this file before modifying the extension. It explains the performance and stability constraints behind One Click Block Twitter's implementation.

## Core Philosophy
One Click Block Twitter is designed to make blocking or muting an X account feel immediate with the lowest possible memory and CPU footprint. Zero background processes, bounded DOM work, predictable targeting, and clear visual feedback are the highest priorities.

## Critical Architectural Decisions

### 1. The React Unmount Bug (Why we don't use `display: none` initially)
**DO NOT change `opacity: 0.3` to `display: none` prior to the action execution.**
Twitter is a React SPA. If you apply `display: none` to a tweet container, React immediately unmounts it from the Virtual DOM. This causes the internal dropdown menu (which we need to interact with via DOM automation) to vanish or fail to render.
**Solution:** We apply `opacity: 0.3` and `pointer-events: none` during the execution phase to give the user visual feedback without unmounting the DOM. Once the action succeeds, we apply `display: none` for complete removal. On failure, previous inline styles are restored.

### 2. Event Delegation & Concurrency Guard
**DO NOT attach `addEventListener` to individual injected buttons.**
Twitter uses an infinite scroll mechanism. Injecting thousands of buttons with individual event listeners causes memory bloat and lag.
**Solution:** We use a single global click listener attached to `document.body` that intercepts clicks via `e.target.closest('.hajb-action-btn')`. An `actionInFlight` lock ignores overlapping clicks while a dropdown or confirmation sheet is open so concurrent clicks cannot collide on X's shared `[data-testid="Dropdown"]` portal.

### 3. Synchronous Settings Caching & Storage-Gated Startup
**DO NOT use `await chrome.storage.local.get` inside the `MutationObserver` or click handlers.**
`Storage` loads settings once into a local variable and keeps it updated via `chrome.storage.onChanged`. `Observer.start()` waits for the initial `chrome.storage.local.get` callback (falling back to defaults if `data` is undefined) before observing or injecting, preventing wasted work when disabled or double-rendering when set to `mute`.

When `storage.onChanged` fires while `document.hidden` is `true`, DOM updates are deferred (`settingsDirty = true`) until the tab becomes visible again.

### 4. Smart Multi-Language DOM Matching (i18n Bypass)
**DO NOT fetch `messages.json` dynamically inside `content.js`.**
The script matches normalized English and Arabic action prefixes in the X DOM. Prefix matching deliberately rejects inverse actions such as `Unmute` and `إلغاء الكتم`. Button labels from `chrome.i18n.getMessage` are cached once per action type.

### 5. Content Security Policy & AMO Compliance (No `innerHTML`)
**DO NOT inject remote scripts, stylesheets, or fonts, and DO NOT use `innerHTML` in `content/content.js`.**
`content/content.js` builds one SVG template per action type via `document.createElementNS` and clones it with `cloneNode(true)` into buttons via `replaceChildren`. `content/content.css` applies `contain: layout style paint;` on `.hajb-action-btn`.

### 6. Zero Background Process (3.2.0)
**DO NOT add a `background` service worker, event page, or action-counter storage writes.**
The extension has no `background.js` and no action statistics, keeping background process RAM at 0 MB in Chrome, Edge, and Firefox and avoiding cross-tab `storage.onChanged` broadcasts on every click. `scripts/validate-extension.mjs` enforces `!manifest.background`.

### 7. Explicit HTTPS App Host Matching
Static `content_scripts` in `manifest.json` target only explicit HTTPS X/Twitter web-app origins (`x.com`, `www`, `mobile`, `pro` and `twitter.com` equivalents) rather than `*://*.x.com/*`, preventing Isolated World allocation on non-timeline subdomains (`help.x.com`, `developer.x.com`, `ads.x.com`, etc.).

### 8. Targeted DOM Lifecycle & Weak Cache
- Never inject hidden buttons for disabled switches. Only enabled buttons are created, and disabling a switch or the master toggle removes those buttons from the DOM (and clears `controls` when all buttons are disabled).
- Keep cached control references in a `WeakMap` keyed by tweet (`{ caret, parent, account, dismiss }`). Validate `caret.isConnected`, `caret.parentElement === parent`, `tweet.contains(caret)`, and enabled button references before skipping work so React action-bar replacement still recovers cleanly.
- Look up existing buttons strictly among direct children of `caret.parentElement` rather than scanning the entire tweet subtree.

### 9. Observer Scoping & Bounded Discovery
- Observe `#react-root` when present (falling back to `document.body`). Disconnect when `document.hidden`, master switch is off, both action switches are off, or `pagehide` fires.
- Avoid `Array.from(mutation.addedNodes)` allocations, avoid full-ancestor `target.closest('.hajb-action-btn')` walks, deduplicate repeated `mutation.target` records per callback, skip non-element nodes, and skip leaf/inline tags (`SPAN`, `A`, `IMG`, `SVG`, etc.) before calling `querySelectorAll`.
- `flush()` yields after 20 actual live injections per 32 ms task while immediately evicting detached (`!tweet.isConnected`) or already-intact tweets in the same tick without consuming the 20-tweet budget. The pending queue caps at 256 tweets with a catch-up scan on overflow; pause clears pending state and any active scan iterator.
- `Automation.waitForElement` observes `#layers` when present (falling back to `document.body`) and immediately disconnects and cancels its timeout upon resolution.

### 10. Link Cleaning (`content/clean-url.js`)
`content/clean-url.js` runs in the `MAIN` world at `document_start` to wrap `navigator.clipboard.writeText` and handle legacy `copy` events. It bails out before regex scanning when copied text lacks `?` or an X/Twitter domain, parses each candidate URL at most once, removes only known tracking parameters (`a`, `s`, `t`, `ref_src`, `ref_url`, `utm_*`) from supported post URLs, never reads the system clipboard, and runs independently of timeline switches.

### 11. Action Completion Limitation
The automation treats completion of menu/confirmation clicks as success without verifying server acceptance.

**Summary for maintainers:** Keep background memory at 0 MB, keep timeline observer work zero-allocation and bounded, remove disabled buttons from DOM, and run `npm test && npm run check` after behavior changes.
