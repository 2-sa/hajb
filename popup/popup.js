document.addEventListener('DOMContentLoaded', () => {
  const DEFAULT_SETTINGS = {
    actionType: 'block',
    hajbEnabled: true,
    accountActionEnabled: true,
    notInterestedEnabled: true
  };

  const requestedLanguage = (chrome.i18n.getUILanguage?.() || 'ar').split('-')[0].toLowerCase();
  const uiLanguage = requestedLanguage === 'en' ? 'en' : 'ar';
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
    footerStatus: document.getElementById('footerStatus')
  };
  const actionInputs = [...document.querySelectorAll('input[name="actionType"]')];
  let state = { ...DEFAULT_SETTINGS };

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
      actionType: data?.actionType === 'mute' ? 'mute' : 'block'
    };
    renderControls();
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
});
