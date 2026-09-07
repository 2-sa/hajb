# Performance changes in 3.1.3

This release reduces avoidable content-script work without changing block, mute, or not-interested actions.

- Counter updates no longer scan or redraw timeline buttons.
- Intact controls are reused through a weak cache; normal changes inside a tweet do not trigger another descendant search.
- Discovery pauses while the tab is hidden or timeline actions are disabled, and catches up on resume.
- Injection yields between batches of at most 20 tweets. The pending mutation queue holds at most 256 tweets; overflow triggers a catch-up scan.
- Detached queued tweets are skipped. Pause clears pending work and any scan snapshot.
- Menu wait timers are cancelled on success.

## Verification

The Node DOM regression harness measured 200 document-level control scans for 100 counter changes before the fix, and zero afterward. For 100 ordinary mutations within an already prepared tweet, it measured 300 tweet descendant queries before the fix, and zero afterward. These are operation counts in a synthetic test, not browser CPU or RAM percentages.

Regression tests also cover 1,000 existing tweets, a burst of 600 new tweets, action-bar replacement, detached tweets, settings changes, pause/resume, and temporary observer/timer cleanup.

Live X CPU, heap, frame timing, and browser-process memory were not measured in this environment. A full-page catch-up query still scales with the current DOM; the batch limit does not bound that query's duration. The X application and its media also consume resources independently of this extension.

## Repeating a browser comparison

Use the same browser version and profile, one X tab, and no other extensions. Compare 3.1.2 and 3.1.3 separately on the same route and similar content. After refreshing, record 60 seconds of identical scrolling in the browser performance panel. Repeat three times for each version. Compare scripting time, long tasks, and retained DOM nodes after garbage collection, rather than only total browser RAM. Check idle and hidden-tab behavior, then verify that returning to the tab and replacing/reloading posts restores the action buttons. Do not activate real account actions during a performance-only run.
