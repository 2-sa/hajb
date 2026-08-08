const EMPTY_ACTION_STATS = Object.freeze({
  block: 0,
  mute: 0,
  notInterested: 0
});

const normalizeActionStats = (stats = {}) => Object.fromEntries(
  Object.keys(EMPTY_ACTION_STATS).map((key) => [
    key,
    Number.isSafeInteger(stats[key]) && stats[key] >= 0 ? stats[key] : 0
  ])
);

let statsWriteQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'HAJB_RECORD_ACTION' || !(message.actionType in EMPTY_ACTION_STATS)) {
    return false;
  }

  statsWriteQueue = statsWriteQueue.then(async () => {
    const stored = await chrome.storage.local.get({ actionStats: EMPTY_ACTION_STATS });
    const actionStats = normalizeActionStats(stored.actionStats);
    actionStats[message.actionType] += 1;
    await chrome.storage.local.set({ actionStats });
    return actionStats;
  });

  statsWriteQueue.then(
    (actionStats) => sendResponse({ ok: true, actionStats }),
    (error) => sendResponse({ ok: false, error: error.message })
  );

  return true;
});
