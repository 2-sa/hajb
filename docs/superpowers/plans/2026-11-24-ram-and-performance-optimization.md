# RAM & Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the extension's background process and action counter, narrow host injection, deeply optimize `content.js` / `content.css` / `clean-url.js` for minimal RAM and GC overhead, and bump the release version to `3.2.0`.

**Architecture:** Remove `background.js` and all `actionStats` tracking/UI so the extension spawns 0 MB of background Service Worker / Event Page memory. Refactor `content/content.js` into an IIFE that waits for initial storage settings, scopes its `MutationObserver` to `#react-root` with zero-allocation filtering and immediate detached-tweet eviction, builds cached SVG templates via `createElementNS` + `cloneNode(true)`, removes disabled buttons from the DOM instead of hiding them, defers hidden-tab setting updates, and hardens menu automation with `#layers` scoping and an `inFlight` lock.

**Tech Stack:** Plain ES JavaScript (Manifest V3), HTML, CSS, Node.js `>=22` built-in test runner (`node:test`, `node:vm`).

**Spec:** `docs/superpowers/specs/2026-11-24-ram-and-performance-optimization-design.md`

## Global Constraints

- Manifest V3 only; zero external dependencies; zero build/transpile step; Node.js `>=22`.
- Keep `"permissions": ["storage"]` only; no `host_permissions`, no `web_accessible_resources`, no remote assets/fonts/scripts.
- Keep `browser_specific_settings.gecko` (`id: "hajb@2-sa.github.io"`, `strict_min_version: "140.0"`, `data_collection_permissions.required: ["none"]`).
- Extension version is `3.2.0` in both `manifest.json` and `package.json`.
- Zero background context (`!manifest.background`, no `background.js`, no `chrome.runtime.sendMessage`).
- Preserve the React unmount workaround (`opacity: 0.3` + `pointer-events: none` during execution, `display: none` after success, restore prior inline styles on failure).
- Keep a single delegated click listener on `document.body` (never per-button listeners) and synchronous cached settings reads.
- No `innerHTML` anywhere in `content/content.js`; use `document.createElementNS('http://www.w3.org/2000/svg', ...)` templates cloned via `cloneNode(true)`.
- Both `_locales/ar/messages.json` and `_locales/en/messages.json` must have identical, 100%-used message key sets.

## Review Focus

1. **Initial storage read returns `undefined` or fails (`chrome.runtime.lastError`):** `content/content.js` must fall back to normalized defaults and still start `Observer` rather than silently hanging the extension. (Pinned in Task 4.)
2. **Multiple settings toggle while a tab is hidden (`document.hidden === true`):** switching `accountActionEnabled` OFF, changing `actionType` to `mute`, and toggling `accountActionEnabled` back ON before the tab becomes visible must do zero DOM work while hidden and inject `mute` buttons cleanly on resume. (Pinned in Task 4.)
3. **Rapid overlapping clicks on two tweets while a dropdown/confirm sheet is still open:** the second click must be ignored while `inFlight` is true, leaving the second tweet's inline styles untouched, and the lock must always release after both success and failure. (Pinned in Task 4.)
4. **Tweet without `[data-testid="caret"]` or detached queued tweets flooding `pendingTweets`:** caret-less tweets must not throw, and 100+ detached tweets queued ahead of live tweets must be evicted immediately without stalling live button injection across multiple 32 ms ticks. (Pinned in Task 4.)
5. **Uppercase or `pro.x.com` / `pro.twitter.com` post links and non-URL text in `clean-url.js`:** uppercase URLs and `pro.` hosts must clean tracking params, while text without `?` or X/Twitter domains must bail out without invoking `new URL(...)`, and matched URLs must call `new URL(...)` only once. (Pinned in Task 3.)

---

### Task 1: Remove background worker, narrow manifest hosts, bump to `3.2.0`, and tighten validator

**Files:**
- Delete: `background.js`
- Delete: `test/background.test.js`
- Modify: `scripts/validate-extension.mjs`
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: none.
- Produces:
  - `manifest.json` version `"3.2.0"`, no `background` field, explicit HTTPS `matches` list (`https://x.com/*`, `https://www.x.com/*`, `https://mobile.x.com/*`, `https://pro.x.com/*`, `https://twitter.com/*`, `https://www.twitter.com/*`, `https://mobile.twitter.com/*`, `https://pro.twitter.com/*`) on both `content_scripts`.
  - `package.json` version `"3.2.0"`.
  - `scripts/validate-extension.mjs` enforcing `!manifest.background` and explicit HTTPS-only non-wildcard host matches.

- [ ] **Step 1: Add failing invariant checks in `scripts/validate-extension.mjs`**

Add invariants verifying:
- `!manifest.background` (`Extension must not declare a background script or service worker`)
- Every entry in `manifest.content_scripts` has `matches` containing only explicit `https://<host>/*` patterns with no wildcard subdomain (`*://` or `*.`).

- [ ] **Step 2: Run validator to verify it fails against the current manifest**

Run: `npm.cmd run check`
Expected: FAIL with `"Extension must not declare a background script or service worker"`

- [ ] **Step 3: Update `manifest.json`, `package.json`, `.github/workflows/release.yml`, and delete `background.js` and `test/background.test.js`**

- In `manifest.json`: bump `"version"` to `"3.2.0"`, delete `"background"` block, and update both `content_scripts[*].matches` to the 8 explicit HTTPS X/Twitter app hosts.
- In `package.json`: bump `"version"` to `"3.2.0"`.
- In `.github/workflows/release.yml`: remove `background.js` from the `zip -r` command.
- Delete `background.js` and `test/background.test.js`.

- [ ] **Step 4: Run validation and test suite to verify they pass**

Run: `npm.cmd run check; if ($LASTEXITCODE -eq 0) { npm.cmd test }`
Expected: PASS (`Validated Manifest V3 package 3.2.0`, 0 test failures).

- [ ] **Step 5: Commit**

```powershell
git add -A manifest.json package.json scripts/validate-extension.mjs .github/workflows/release.yml background.js test/background.test.js
git commit -m "perf: remove background worker, scope manifest hosts, bump to 3.2.0"
```

---

### Task 2: Remove action stats UI/logic from popup and prune unused locale keys

**Files:**
- Modify: `test/popup.test.js`
- Modify: `popup/popup.html`
- Modify: `popup/popup.css`
- Modify: `popup/popup.js`
- Modify: `_locales/ar/messages.json`
- Modify: `_locales/en/messages.json`

**Interfaces:**
- Consumes: `manifest.json` (`default_popup`, `default_locale`), `scripts/validate-extension.mjs` locale key parity check.
- Produces:
  - Compact popup without `.stats-section` or `min-height: 520px`, with `id="accountButtonTitle"` and `aria-labelledby="accountButtonTitle"` on `#actionChoices`.
  - `popup/popup.js` reading/writing only `{ actionType, hajbEnabled, accountActionEnabled, notInterestedEnabled }` with zero `runtime.sendMessage` or `storage.onChanged` usage.
  - Identical 21-key locale sets in `_locales/ar/messages.json` and `_locales/en/messages.json` (all active, zero dead keys).

- [ ] **Step 1: Update `test/popup.test.js` with failing tests for stats removal, natural height, localized radiogroup label, and control persistence**

Update `test/popup.test.js` to assert:
- `popup.html` renders controls (`hajbEnabled`, `accountActionEnabled`, `notInterestedEnabled`, `actionChoices` with `aria-labelledby="accountButtonTitle"` and no hardcoded Arabic `aria-label`) and does NOT contain `stats-section`, `blockCount`, `muteCount`, `notInterestedCount`, `totalCount`, or `resetStats`.
- `popup.css` does NOT set `min-height: 520px` on `.panel` or retain `.stats-section` / `.stats-strip` rules.
- `popup.js` loads controls, switches RTL/LTR, persists boolean toggles and `actionType`, and never calls `chrome.runtime.sendMessage` or registers `chrome.storage.onChanged`.

- [ ] **Step 2: Run popup tests to verify they fail**

Run: `node --test test/popup.test.js`
Expected: FAIL on assertions checking removed stats markup/styles/storage defaults.

- [ ] **Step 3: Implement changes in `popup/popup.html`, `popup/popup.css`, `popup/popup.js`, `_locales/ar/messages.json`, and `_locales/en/messages.json`**

- `popup/popup.html`: remove `<section class="dashboard-section stats-section">...</section>`, add `id="accountButtonTitle"` on the account card `<h2>`, replace `aria-label="إجراء الحساب"` on `#actionChoices` with `aria-labelledby="accountButtonTitle"`.
- `popup/popup.css`: remove `min-height: 520px` from `.panel` and delete `.stats-section`, `.section-heading--stats`, `.reset-button`, `.stats-strip`, `.stat`, `.stat + .stat`, `.stat::before`, `.stat strong`, `.stat span`, `.stat--*`, `.total-line`, `.total-line strong`.
- `popup/popup.js`: remove `EMPTY_ACTION_STATS`, `actionStats`, `Intl.NumberFormat`, `normalizeStats`, `renderStats`, stats element references, `resetStats` listener, and `chrome.storage.onChanged` listener.
- `_locales/ar/messages.json` and `_locales/en/messages.json`: remove `modeEyebrow`, `actionTypeLabel`, `privacyNote`, `statsEyebrow`, `statsTitle`, `resetStats`, `blockStat`, `muteStat`, `notInterestedStat`, `totalLabel`.

- [ ] **Step 4: Run tests and extension validator**

Run: `node --test test/popup.test.js; if ($LASTEXITCODE -eq 0) { npm.cmd run check }`
Expected: PASS (all popup tests pass, `Validated Manifest V3 package 3.2.0`).

- [ ] **Step 5: Commit**

```powershell
git add popup/popup.html popup/popup.css popup/popup.js _locales/ar/messages.json _locales/en/messages.json test/popup.test.js
git commit -m "perf: remove popup action stats UI and unused locale keys"
```

---

### Task 3: Optimize `content/clean-url.js`

**Files:**
- Modify: `test/clean-url.test.js`
- Modify: `content/clean-url.js`

**Interfaces:**
- Consumes: none.
- Produces: optimized `content/clean-url.js` preserving `navigator.clipboard.writeText` and `copy` event cleaning behavior with hoisted constants, fast-path bailout, single `new URL` per candidate, and `pro.` host support.

- [ ] **Step 1: Add failing tests in `test/clean-url.test.js`**

Add tests asserting:
1. Cleans tracking parameters on `https://pro.x.com/...`, `https://pro.twitter.com/...`, and uppercase `HTTPS://X.COM/...` post URLs.
2. Uses a counting `URL` constructor wrapper to verify `0` `URL` constructions for plain text or links without `?` or X/Twitter domains, and at most `1` `URL` construction per matched post URL (both when modified and when unchanged).

- [ ] **Step 2: Run clean-url tests to verify they fail**

Run: `node --test test/clean-url.test.js`
Expected: FAIL (`pro.x.com` unchanged and `URL` constructed twice per matched post URL).

- [ ] **Step 3: Optimize `content/clean-url.js`**

Hoist `URL_PATTERN`, `FAST_HOST_HINT = /(?:x|twitter)\.com/i`, `SUPPORTED_HOST = /^(?:www\.|mobile\.|pro\.)?(?:x\.com|twitter\.com)$/i`, `SUPPORTED_POST_PATH`, `TRACKING_PARAMS = new Set(['a', 's', 't', 'ref_src', 'ref_url'])`, and `UTM_PARAM = /^utm_/i`; bail out early when `!text.includes('?') || !FAST_HOST_HINT.test(text)`; track `let changed = false` while deleting matching keys and return `changed ? url.href : candidate`.

- [ ] **Step 4: Run clean-url tests and full suite**

Run: `node --test test/clean-url.test.js; if ($LASTEXITCODE -eq 0) { npm.cmd run check }`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add content/clean-url.js test/clean-url.test.js
git commit -m "perf: optimize URL cleaner fast-path and avoid duplicate URL parsing"
```

---

### Task 4: Deep RAM & CPU refactor of `content/content.js` and `content/content.css`

**Files:**
- Modify: `test/content.test.js`
- Modify: `content/content.js`
- Modify: `content/content.css`

**Interfaces:**
- Consumes: `manifest.json` (`content/content.js`, `content/content.css`), `_locales/*/messages.json` keys (`extName`, `blockButtonLabel`, `muteButtonLabel`, `notInterestedButtonLabel`).
- Produces:
  - IIFE-wrapped `content/content.js` with zero `innerHTML`, zero `chrome.runtime.sendMessage`, zero `console.log` / `extractScreenName`, cached `i18n` labels, `createElementNS` + `cloneNode(true)` SVG templates, storage-gated startup with default fallback, DOM removal of disabled buttons, deferred hidden-tab updates, `#react-root`-scoped zero-allocation `MutationObserver`, immediate detached-tweet eviction in `flush()`, `#layers`-scoped `waitForElement`, and `inFlight` click guard.
  - `content/content.css` with `contain: layout style paint;` and no unused `[hidden]` override.

- [ ] **Step 1: Upgrade `test/content.test.js` harness and add failing tests for all new invariants and Review Focus cases**

Enhance `FakeElement` / `createPage` in `test/content.test.js` to support `nodeType`, `isConnected`, `classList`, `createElementNS`, `cloneNode(deep)`, `replaceChildren`, `getElementById` (`#react-root` and `#layers`), and instrumentation counters (`i18nCalls`, `urlQueries`, `innerHTMLWrites`, `closestCalls`, `logCalls`).
Update/add tests verifying:
- Waits for initial `chrome.storage.local.get` before observing/injecting; falls back to defaults if storage callback returns `undefined` or `chrome.runtime.lastError` is set.
- Only creates enabled buttons (no disabled/hidden buttons in DOM), removes buttons when toggled OFF (per-button or master), and re-injects when toggled back ON.
- Zero `innerHTML` writes; builds SVG via `createElementNS` + `cloneNode(true)`; caches `chrome.i18n.getMessage` to at most once per action type across 100 tweets.
- Observes `#react-root` when present (falls back to `document.body`); skips leaf-tag mutations (`<span>`, `<svg>`) without running `querySelectorAll`; deduplicates repeated `mutation.target` in one batch; never walks `target.closest('.hajb-action-btn')`.
- `flush()` immediately evicts 100 detached tweets ahead of 10 live tweets and injects all 10 live tweets in a single 32 ms tick.
- Hidden tabs defer DOM updates on `storage.onChanged` (even across multiple toggles: OFF → `mute` → ON) and reconcile accurately when becoming visible.
- Caret-less tweets do not throw; existing button lookup is scoped to `caret.parentElement`.
- Automation scopes `waitForElement` to `#layers` when present, ignores overlapping clicks while `inFlight` (leaving second tweet's styles intact and releasing the lock after success or failure), never calls `chrome.runtime.sendMessage`, never calls `console.log`, and never queries `[data-testid="User-Name"]`.
- `content/content.css` declares `contain: layout style paint;` on `.hajb-action-btn` and removes `.hajb-action-btn[hidden]`.

- [ ] **Step 2: Run content tests to verify they fail**

Run: `node --test test/content.test.js`
Expected: FAIL across the new/updated assertions.

- [ ] **Step 3: Implement `content/content.js` and `content/content.css`**

Implement every requirement from Spec Section 5.3 in `content/content.js` (wrapped in an IIFE) and update `content/content.css` (`contain: layout style paint;`, remove `.hajb-action-btn[hidden]`).

- [ ] **Step 4: Run full test suite and extension validator**

Run: `npm.cmd test; if ($LASTEXITCODE -eq 0) { npm.cmd run check }`
Expected: PASS (all tests in `test/*.test.js` pass, `Validated Manifest V3 package 3.2.0`).

- [ ] **Step 5: Commit**

```powershell
git add content/content.js content/content.css test/content.test.js
git commit -m "perf: optimize content script observer, DOM lifecycle, and automation"
```

---

### Task 5: Update project documentation for `3.2.0`

**Files:**
- Modify: `README.md`
- Modify: `AI_CONTEXT.md`
- Modify: `output/store/README.md`

**Interfaces:**
- Consumes: final behavior and file list from Tasks 1–4.
- Produces: accurate documentation matching v`3.2.0` (zero background script, no action counter, updated `zip` command without `background.js`, narrowed HTTPS hosts, and updated architecture/performance notes).

- [ ] **Step 1: Update `README.md`, `AI_CONTEXT.md`, and `output/store/README.md`**

- `README.md`: remove action statistics bullets/references and `background.js` from file tree and `zip` command; update current version section to `3.2.0` describing RAM/performance improvements and removal of background script & counters; update permissions/scope description.
- `AI_CONTEXT.md`: remove outdated counter/background/extractScreenName sections; document zero-background architecture, storage-gated startup, DOM removal of disabled buttons, `createElementNS`/`cloneNode(true)` templates, `#react-root`/`#layers` scoping, detached-tweet eviction, deferred hidden-tab updates, and `inFlight` automation lock.
- `output/store/README.md`: update screenshot caption, add `3.2.0` release notes (preserving `3.1.5` and `3.1.4` history), and update reviewer packaging instructions (`v3.2.0`, `zip` without `background.js`, settings-only storage).

- [ ] **Step 2: Verify full test suite, extension check, and git status**

Run: `npm.cmd test; if ($LASTEXITCODE -eq 0) { npm.cmd run check }`
Expected: PASS (`0` failures, `Validated Manifest V3 package 3.2.0`).

- [ ] **Step 3: Commit**

```powershell
git add README.md AI_CONTEXT.md output/store/README.md
git commit -m "docs: update architecture, README, and store notes for 3.2.0"
```
