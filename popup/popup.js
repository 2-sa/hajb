document.addEventListener('DOMContentLoaded', () => {
  const EMPTY_ACTION_STATS = { block: 0, mute: 0, notInterested: 0 };
  const DEFAULT_SETTINGS = {
    actionType: 'block',
    hajbEnabled: true,
    accountActionEnabled: true,
    notInterestedEnabled: true,
    actionStats: EMPTY_ACTION_STATS
  };

  const requestedLanguage = (chrome.i18n.getUILanguage?.() || 'ar').split('-')[0].toLowerCase();
  const uiLanguage = requestedLanguage === 'en' ? 'en' : 'ar';
  const numberFormatter = new Intl.NumberFormat(uiLanguage);
  document.documentElement.lang = uiLanguage;
  document.documentElement.dir = uiLanguage === 'ar' ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const message = chrome.i18n.getMessage(element.getAttribute('data-i18n'));
    if (message) element.textContent = message;
  });

  const elements = {
    hajbEnabled: document.getElementById('hajbEnabled'),
    accountActionEnabled: document.getElementById('accountActionEnabled'),
    notInterestedEnabled: document.getElementById('notInterestedEnabled'),
    accountFeatureCard: document.getElementById('accountFeatureCard'),
    notInterestedFeatureCard: document.getElementById('notInterestedFeatureCard'),
    signalRail: document.getElementById('signalRail'),
    masterStatus: document.getElementById('masterStatus'),
    statusDot: document.getElementById('statusDot'),
    footerStatus: document.getElementById('footerStatus'),
    resetStats: document.getElementById('resetStats'),
    blockCount: document.getElementById('blockCount'),
    muteCount: document.getElementById('muteCount'),
    notInterestedCount: document.getElementById('notInterestedCount'),
    totalCount: document.getElementById('totalCount')
  };
  const actionInputs = [...document.querySelectorAll('input[name="actionType"]')];
  let state = { ...DEFAULT_SETTINGS, actionStats: { ...EMPTY_ACTION_STATS } };

  const normalizeStats = (stats = {}) => Object.fromEntries(
    Object.keys(EMPTY_ACTION_STATS).map((key) => [
      key,
      Number.isSafeInteger(stats[key]) && stats[key] >= 0 ? stats[key] : 0
    ])
  );

  const renderStats = (stats) => {
    const normalized = normalizeStats(stats);
    elements.blockCount.textContent = numberFormatter.format(normalized.block);
    elements.muteCount.textContent = numberFormatter.format(normalized.mute);
    elements.notInterestedCount.textContent = numberFormatter.format(normalized.notInterested);
    elements.totalCount.textContent = numberFormatter.format(Object.values(normalized).reduce((sum, count) => sum + count, 0));
  };

  const renderControls = () => {
    const active = state.hajbEnabled !== false;
    const accountActive = active && state.accountActionEnabled !== false;
    const interestActive = active && state.notInterestedEnabled !== false;

    elements.hajbEnabled.checked = active;
    elements.accountActionEnabled.checked = state.accountActionEnabled !== false;
    elements.notInterestedEnabled.checked = state.notInterestedEnabled !== false;
    elements.accountFeatureCard.classList.toggle('is-disabled', !accountActive);
    elements.notInterestedFeatureCard.classList.toggle('is-disabled', !interestActive);
    elements.signalRail.classList.toggle('is-paused', !active);
    elements.statusDot.classList.toggle('is-paused', !active);

    actionInputs.forEach((input) => {
      input.checked = input.value === (state.actionType === 'mute' ? 'mute' : 'block');
      input.disabled = !accountActive;
    });

    elements.masterStatus.textContent = chrome.i18n.getMessage(active ? 'activeLabel' : 'pausedLabel');
    elements.footerStatus.textContent = chrome.i18n.getMessage(active ? 'activeFooterStatus' : 'pausedFooterStatus');
  };

  const saveBooleanSetting = (key, value) => {
    state[key] = value;
    renderControls();
    chrome.storage.local.set({ [key]: value });
  };

  chrome.storage.local.get(DEFAULT_SETTINGS, (data) => {
    state = {
      ...DEFAULT_SETTINGS,
      ...data,
      actionType: data.actionType === 'mute' ? 'mute' : 'block',
      actionStats: normalizeStats(data.actionStats)
    };
    renderControls();
    renderStats(state.actionStats);
  });

  for (const key of ['hajbEnabled', 'accountActionEnabled', 'notInterestedEnabled']) {
    elements[key].addEventListener('change', () => saveBooleanSetting(key, elements[key].checked));
  }

  actionInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      state.actionType = input.value;
      chrome.storage.local.set({ actionType: input.value });
    });
  });

  elements.resetStats.addEventListener('click', () => {
    state.actionStats = { ...EMPTY_ACTION_STATS };
    renderStats(state.actionStats);
    chrome.storage.local.set({ actionStats: state.actionStats });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.actionStats) {
      state.actionStats = normalizeStats(changes.actionStats.newValue);
      renderStats(state.actionStats);
    }
  });
});
