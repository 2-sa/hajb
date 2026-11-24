# RAM & Performance Optimization Design — One Click Block (hajb)

**Date:** 2026-11-24  
**Scope:** Project-wide memory, CPU, and architecture optimization (no new features)

---

## 1. Intent & Why

The user suspects that the extension contributes to high browser RAM usage and wants to lower its memory and CPU footprint as far as practical **without adding new features and without breaking core behavior**. During discovery, the user also confirmed that the local action counter (`block` / `mute` / `notInterested` counts and reset) is not needed and may be removed entirely if it contributes to memory overhead.

A full audit of v3.1.5 established two concrete facts:
1. There is no infinite unbounded memory leak in v3.1.5 (a `WeakMap` cache and hidden-tab pausing were already added in v3.1.3).
2. However, the extension still carries two real, avoidable RAM and GC costs:
   - **Dedicated background process overhead (~15–35 MB in Chromium while awake, plus Firefox Event Page wake-ups):** `background.js` exists solely to serialize writes to `actionStats`. Every action click wakes the background context and broadcasts a `chrome.storage.onChanged` event to every open X tab.
   - **Per-tab X renderer heap/GC churn and unnecessary DOM overhead:** `content/content.js` observes all of `document.body`, allocates temporary arrays and double ancestor walks on every X mutation, retains detached tweets across multiple 32 ms batch ticks, injects disabled buttons with `innerHTML`-parsed SVG trees (and runs before initial storage settings load), mutates DOM in hidden tabs on settings changes, and injects scripts into non-timeline subdomains (`help.x.com`, `developer.x.com`, `ads.x.com`, etc.).

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- Eliminate the extension's background process completely (**0 MB** background Service Worker / Event Page RAM in Chrome, Edge, and Firefox).
- Minimize per-tab memory allocations, GC churn, DOM nodes, and main-thread CPU time on X/Twitter tabs.
- Preserve 100% of remaining user-facing features:
  - One-click Block / Mute button beside the tweet caret.
  - One-click "Not interested" button beside the tweet caret.
  - Popup dashboard controls: master switch (`hajbEnabled`), per-button switches (`accountActionEnabled`, `notInterestedEnabled`), and Block/Mute mode selector (`actionType`), stored locally in `chrome.storage.local`.
  - Automatic removal of tracking parameters (`a`, `s`, `t`, `ref_src`, `ref_url`, `utm_*`) from copied X/Twitter post links via `content/clean-url.js`.
  - Arabic and English UI support (X DOM matching in EN/AR; popup in EN or AR fallback with RTL/LTR).
  - Cross-browser Manifest V3 compatibility (Chrome/Edge and Firefox 140+).

### Non-Goals
- Adding any new user-facing feature, setting, shortcut, or UI section.
- Rewriting the extension with a bundler, framework, or external runtime dependencies (stays plain JS/HTML/CSS).
- Changing how X itself manages its own SPA memory or video/media caches.
- Changing how block/mute/not-interested actions interact with X's menu/confirmation UI (the `opacity: 0.3` → `display: none` React unmount workaround in `AI_CONTEXT.md` remains intact).

### Anti-Goals (What Would Count as Failure)
- Breaking one-click Block, Mute, or "Not interested" on either English or Arabic X interfaces.
- Breaking URL tracking cleanup for `navigator.clipboard.writeText` or `copy` events.
- Breaking Firefox 140+ or Chrome/Edge Manifest V3 loading, AMO linter compliance (`innerHTML`), or CSP compliance.
- Leaving `background.js` referenced in `manifest.json` or `.github/workflows/release.yml` (which would break release ZIP builds).
- Leaving empty vertical dead space in the popup after removing the stats section.

---

## 3. Global Constraints

- **Manifest V3 only**, zero external dependencies, zero build step, Node.js `>=22` for tests and validation.
- **Permissions:** keep `"permissions": ["storage"]` only; no `host_permissions`, no `web_accessible_resources`, no remote assets/fonts/scripts (strict MV3 CSP).
- **Firefox Gecko settings:** preserve `browser_specific_settings.gecko` (`id: "hajb@2-sa.github.io"`, `strict_min_version: "140.0"`, `data_collection_permissions.required: ["none"]`).
- **React unmount constraint:** keep `opacity: 0.3` + `pointer-events: none` during action automation and apply `display: none` only after success; restore previous inline styles on failure.
- **Event delegation:** keep a single delegated click listener on `document.body`; never attach per-button listeners.
- **Synchronous cached settings:** never call async `chrome.storage.local.get` inside mutation handlers or click handlers.
- **No `innerHTML` in `content/content.js`:** construct SVG templates once via `document.createElementNS` and clone with `cloneNode(true)`.
- **Version:** do not bump extension version (`3.1.5`) unless requested during release preparation (agent call; easy to adjust if the user wants a version bump later).

---

## 4. Approaches Considered

| Approach | Summary | Trade-offs | Decision |
|---|---|---|---|
| **1. Zero-background + deep content-script optimization** *(selected, extended to remove counter)* | Remove `background.js` and the entire `actionStats` counter (UI, logic, tests, locales, release ZIP entry), narrow manifest host matches, and deeply optimize `content.js`, `content.css`, and `clean-url.js` using `createElementNS`/`cloneNode(true)` SVG templates. | Drops the action counter feature (explicitly approved by user as unnecessary). Achieves **0 MB** background process RAM, zero cross-tab storage broadcasts on clicks, major reduction in per-tab observer/GC churn, and 100% CSP/AMO safety. | **Picked** |
| **2. Conservative (keep `background.js` + optimize `content.js`)** | Keep `background.js` and counters untouched; apply all `content.js`, `content.css`, `manifest.json`, and `clean-url.js` optimizations. | Preserves strictly serialized multi-tab counters, but keeps a ~15–35 MB Service Worker / Event Page waking on every click and startup. | Rejected — user confirmed counters are not needed and wants maximum RAM reduction. |
| **3. Approach 1 + CSS `mask-image` icons** | Same as Approach 1, plus replacing `<svg><path>` children with CSS `mask-image: url("data:image/svg+xml,...")` on `::before`. | Saves 2 DOM nodes per button (~100–200 KB total on X's virtualized DOM), but introduces `data:` URI CSS dependency that is less resilient against future CSP/browser quirks than standard SVG DOM nodes. | Rejected — negligible real RAM savings for higher fragility. |

---

## 5. Detailed Design

### 5.1 Remove Action Counter & Background Process *(User decision)*
- **Delete files:**
  - `background.js`
  - `test/background.test.js`
- **`manifest.json`:**
  - Remove the `"background"` key entirely.
- **`content/content.js`:**
  - Remove `recordSuccessfulAction` and all `chrome.runtime.sendMessage` calls.
- **`popup/popup.html` & `popup/popup.css` & `popup/popup.js`:**
  - Remove `.stats-section` markup from `popup/popup.html`.
  - Remove stats styles (`.stats-section`, `.section-heading--stats`, `.reset-button`, `.stats-strip`, `.stat*`, `.total-line`) from `popup/popup.css`.
  - Remove `min-height: 520px` from `.panel` in `popup/popup.css` so the popup fits its controls and footer cleanly with no empty gap.
  - **Accessibility fix (agent call):** Replace hardcoded Arabic `aria-label="إجراء الحساب"` on `#actionChoices` in `popup/popup.html` with `aria-labelledby="accountButtonTitle"` (adding `id="accountButtonTitle"` to the account card `<h2>`).
  - Simplify `popup/popup.js`: remove `EMPTY_ACTION_STATS`, `actionStats` from `DEFAULT_SETTINGS`, `Intl.NumberFormat`, `normalizeStats`, `renderStats`, `resetStats` click handler, and `chrome.storage.onChanged` listener (only one popup instance exists at a time and no background writes occur anymore).
  - Do **not** add migration code to delete legacy `actionStats` from existing users' `chrome.storage.local` (agent call: an unread ~50-byte key has zero runtime cost and avoids pointless startup storage writes).
- **Resulting Popup Layout (text sketch):**
  ```text
  ┌─────────────────────────────────────────┐
  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ (signal rail)    │
  │ [Logo] ONE CLICK BLOCK     فعّال (●──)  │
  │        خطّك الزمني، بقرارك.              │
  ├─────────────────────────────────────────┤
  │ التحكم                                  │
  │ أزرار الخط الزمني                       │
  │ ┌─────────────────────────────────────┐ │
  │ │ (⊘) إجراء الحساب              (●──) │ │
  │ │     زر مباشر للحظر أو الكتم         │ │
  │ │  [    حظر    ]   [    كتم    ]      │ │
  │ └─────────────────────────────────────┘ │
  │ ┌─────────────────────────────────────┐ │
  │ │ (👁̸) غير مهتم                  (●──) │ │
  │ │     إخفاء المنشور وتحسين التوصيات   │ │
  │ └─────────────────────────────────────┘ │
  ├─────────────────────────────────────────┤
  │   ● فعّال • يعمل محليًا بلا تتبع        │
  └─────────────────────────────────────────┘
  ```
- **Locales (`_locales/ar/messages.json` & `_locales/en/messages.json`):**
  - Remove stats keys: `statsEyebrow`, `statsTitle`, `resetStats`, `blockStat`, `muteStat`, `notInterestedStat`, `totalLabel`.
  - Remove pre-existing unused keys (agent call): `modeEyebrow`, `actionTypeLabel`, `privacyNote`.
  - Keep both locale files with identical key sets (21 active keys, every key referenced).
- **Packaging & Docs:**
  - Remove `background.js` from `.github/workflows/release.yml` (`zip -r` file list).
  - Update `scripts/validate-extension.mjs` to assert `!manifest.background` and verify explicit HTTPS host matches in `manifest.json`.
  - Update `README.md`, `AI_CONTEXT.md`, and `output/store/README.md` to reflect zero background script, no stats counter, updated `zip` command, and new performance invariants.

### 5.2 Narrow Content-Script Host Matching *(Agent call aligned with Approach 1)*
- In `manifest.json`, replace `["*://*.twitter.com/*", "*://*.x.com/*"]` in both `content_scripts` entries with explicit HTTPS X/Twitter web-app origins:
  ```json
  [
    "https://x.com/*",
    "https://www.x.com/*",
    "https://mobile.x.com/*",
    "https://pro.x.com/*",
    "https://twitter.com/*",
    "https://www.twitter.com/*",
    "https://mobile.twitter.com/*",
    "https://pro.twitter.com/*"
  ]
  ```
- Prevents allocating Isolated World JS contexts, running `MutationObserver`, or attaching `clean-url.js` on non-timeline subdomains (`help.x.com`, `developer.x.com`, `ads.x.com`, `business.x.com`, `about.x.com`, etc.).

### 5.3 Deep Optimization of `content/content.js` & `content/content.css`

1. **Scope encapsulation:** Wrap `content/content.js` in an IIFE `(() => { ... })();`.
2. **Wait for initial settings before observing or injecting:**
   - Do not start `Observer` until BOTH initial `chrome.storage.local.get(...)` has completed AND `document.readyState !== 'loading'`.
   - If the extension is disabled (`!hajbEnabled` or both switches off) or the tab loads hidden (`document.hidden === true`), perform **zero** DOM queries, **zero** button creations, and leave `MutationObserver` disconnected.
   - If `chrome.storage.local.get` reports an error (or missing callback values), fall back to normalized defaults so the script never stalls permanently.
3. **Only create enabled buttons; remove disabled buttons from DOM:**
   - Stop creating/injecting hidden buttons when a feature switch is OFF.
   - In `injectTweetButtons(tweets)`:
     - Only inject `accountButton` when `hajbEnabled && accountActionEnabled`.
     - Only inject `notInterestedButton` when `hajbEnabled && notInterestedEnabled`.
     - Look up existing injected buttons inside `caret.parentElement` (direct children of the small action bar) instead of running `tweet.querySelector(...)` across the entire tweet subtree.
     - If an existing button in `caret.parentElement` is now disabled, remove it (`btn.remove()`).
     - Cache `{ caret, parent: caret.parentElement, account: needAccount ? accountButton : null, dismiss: needDismiss ? notInterestedButton : null }` in `controls` (`WeakMap`).
   - Update `hasIntactControls(tweet, settings)` to verify:
     - `cached` exists, `cached.caret.isConnected`, `cached.caret.parentElement === cached.parent`, and `tweet.contains(cached.caret)`.
     - For account button: if enabled, `cached.account` exists, `cached.account.parentElement === cached.parent`, and `cached.account.dataset.actionType === settings.actionType`; if disabled, `!cached.account`.
     - For dismiss button: if enabled, `cached.dismiss` exists and `cached.dismiss.parentElement === cached.parent`; if disabled, `!cached.dismiss`.
   - When settings change while tab is visible:
     - If master switch is OFF or both button switches are OFF: stop observer, remove all `.hajb-action-btn` elements from DOM, and replace `controls = new WeakMap()` to drop all cached references immediately.
     - If only one button switch turned OFF: remove only that button class from DOM and null out its field (`account` or `dismiss`) on the owning tweet's `controls` entry (so the remaining button stays intact with zero re-injection).
     - If a button switch turned ON: ensure observer is running and trigger a catch-up scan (`needsScan = true; schedule()`).
     - If `actionType` (`block` ↔ `mute`) changed while `accountActionEnabled` is ON: update existing `.hajb-account-action-btn` buttons in place.
   - **Deferred updates in hidden tabs:**
     - When `chrome.storage.onChanged` fires while `document.hidden === true`, update `cachedSettings` and set `settingsDirty = true` without touching the DOM.
     - On resume (`visibilitychange` to visible or `pageshow`), if `settingsDirty` is set, clear it and run button reconciliation before starting/stopping the observer.
4. **Zero `innerHTML` & cached `i18n` labels:**
   - Cache resolved `chrome.i18n.getMessage(...)` strings once per action type (`block`, `mute`, `notInterested`) instead of invoking the extension API on every button injection.
   - Lazily build and cache one `<svg viewBox="0 0 24 24" width="18.75" height="18.75" fill="currentColor" aria-hidden="true"><path d="..."></path></svg>` node per action type using `document.createElementNS('http://www.w3.org/2000/svg', ...)`.
   - `applyActionPresentation` swaps the button's icon by cloning the cached template (`template.cloneNode(true)`) via `replaceChildren` (or removing existing child nodes + `appendChild`), with zero `innerHTML` parsing.
5. **Low-allocation, tightly filtered `MutationObserver`:**
   - Observe `document.getElementById('react-root') || document.body` with `{ childList: true, subtree: true }` (covers both `<main>` timelines and `#layers` modals while ignoring non-X body portals).
   - Eliminate `Array.from(mutation.addedNodes)` and closure allocations: use indexed `for` loops to check `isOnlyOwnButtons(mutation.addedNodes)`.
   - Eliminate full-ancestor `target.closest('.hajb-action-btn')` walk: check at most 3 levels (`target`, `target.parentElement`, `target.parentElement?.parentElement`) via `classList.contains(BUTTON_CLASS)`.
   - Deduplicate repeated `mutation.target` entries within a single `handleMutations(mutations)` callback using a per-batch `Set` (only allocated when `mutations.length > 1`).
   - Skip pure-removal mutations (`addedNodes.length === 0`) unless at least one node in `removedNodes` is an element (`nodeType === 1`).
   - In `addedNodes`, skip non-element nodes (`node.nodeType !== 1`) and skip leaf/inline tag names that cannot contain `<article data-testid="tweet">` (`SPAN`, `A`, `IMG`, `SVG`, `PATH`, `VIDEO`, `AUDIO`, `BUTTON`, `INPUT`, `TEXTAREA`, `P`, `TIME`, `BR`, `HR`, `SCRIPT`, `STYLE`, `LINK`, `META`, `SOURCE`, `TRACK`, `CANVAS`, `IFRAME`) before calling `node.querySelectorAll(TWEET)`.
6. **Immediate detached-tweet eviction in `flush()`:**
   - Use O(1) `tweet.isConnected` instead of `document.body.contains(tweet)`.
   - Loop `while (batch.length < 20)` when popping from `pendingTweets` / `scan` so detached or already-intact tweets are discarded immediately in the same tick instead of consuming the 20-tweet injection budget and staying pinned in memory across multiple 32 ms timers.
   - Avoid duplicating `isConnected` / `hasIntactControls` checks between `flush()` and `injectTweetButtons()` (keep `injectTweetButtons` checking `tweet.isConnected` and `hasIntactControls` only once per tweet).
7. **Automation & Click Handler Hardening:**
   - Remove unused `extractScreenName` and per-click `console.log` (`Logger.info`) so no extra DOM queries run and no blocked/muted usernames accumulate in the console buffer. Keep `console.error` only for actual failures.
   - Add an `inFlight` lock in the delegated click handler so clicking a second tweet while a menu/confirmation dialog is still open is ignored instead of colliding on `[data-testid="Dropdown"]` and acting on the wrong account.
   - Scope `Automation.waitForElement` observer to `document.getElementById('layers') || document.body` (falling back to `document.body` if `#layers` does not exist).
   - Resolve `caret` on click from `controls.get(tweet)?.caret` (when connected inside `tweet`) before falling back to `btn.parentElement?.querySelector('[data-testid="caret"]')` or `tweet.querySelector('[data-testid="caret"]')`.
8. **`content/content.css`:**
   - Add `contain: layout style paint;` to `.hajb-action-btn`.
   - Remove unused `.hajb-action-btn[hidden]` rule since disabled buttons are removed from DOM rather than hidden.

### 5.4 Optimize `content/clean-url.js`
- Hoist all regexes and tracking parameter names (`Set(['a', 's', 't', 'ref_src', 'ref_url'])`) to top-level constants inside the IIFE.
- Add an O(n) zero-allocation fast-path guard at the top of `cleanText`: if `typeof text !== 'string' || !text.includes('?') || !/(?:x|twitter)\.com/i.test(text)` return `text` immediately.
- Support `pro.` alongside `www.` and `mobile.` in the host regex (`/^(?:www\.|mobile\.|pro\.)?(?:x\.com|twitter\.com)$/i`).
- Track `let changed = false` while removing matching query parameters and return `changed ? url.href : candidate`, eliminating the redundant second `new URL(candidate)` allocation.

---

## 6. What's Left to the Builder

- Exact helper names and internal code organization inside `content/content.js`, `popup/popup.js`, and `content/clean-url.js`.
- Exact updates to the mock DOM harness (`FakeElement`) in `test/content.test.js` (adding `isConnected`, `nodeType`, `classList`, `createElementNS`, `cloneNode`, `replaceChildren`, `#react-root`, `#layers`) while preserving full unit coverage of every behavior and edge case.
- Exact test case structure across `test/content.test.js`, `test/popup.test.js`, and `test/clean-url.test.js`.
- Checking whether `output/store/README.md` historical release notes (`3.1.4`/`3.1.5`) should stay archival while updating current package reproduction notes and screenshot captions.

---

## 7. Verification Criteria

1. `npm test` and `npm run check` pass with 0 failures (no `background.test.js`, updated `content.test.js`, `popup.test.js`, `clean-url.test.js`, `validate-extension.mjs`).
2. Manual browser verification checklist (for the user after implementation):
   - Chrome/Edge Task Manager (`Shift+Esc`) or Firefox `about:processes`: confirm **no background Service Worker / Event Page process** appears for the extension (0 MB background RAM).
   - X.com timeline (EN & AR): verify Block, Mute, and "Not interested" work end-to-end, popup toggles immediately inject/remove buttons cleanly, popup renders cleanly without vertical dead space, and copying a post URL strips tracking params.
   - Verify `help.x.com` / `developer.x.com` does not receive injected scripts.
