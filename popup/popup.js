document.addEventListener('DOMContentLoaded', () => {
  const requestedLanguage = (chrome.i18n.getUILanguage?.() || 'ar').split('-')[0].toLowerCase();
  const uiLanguage = requestedLanguage === 'en' ? 'en' : 'ar';
  document.documentElement.lang = uiLanguage;
  document.documentElement.dir = uiLanguage === 'ar' ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const message = chrome.i18n.getMessage(element.getAttribute('data-i18n'));
    if (message) element.textContent = message;
  });

  const actionInputs = [...document.querySelectorAll('input[name="actionType"]')];

  chrome.storage.local.get({ actionType: 'block' }, (data) => {
    const actionType = data.actionType === 'mute' ? 'mute' : 'block';
    const selectedInput = actionInputs.find((input) => input.value === actionType);
    if (selectedInput) selectedInput.checked = true;
  });

  actionInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) chrome.storage.local.set({ actionType: input.value });
    });
  });
});
