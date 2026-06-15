document.addEventListener('DOMContentLoaded', async () => {
  // Translate UI
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const message = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
    if (message) el.textContent = message;
  });

  const actionTypeSelect = document.getElementById('actionType');
  const languageSelect = document.getElementById('language');

  // Load Settings
  chrome.storage.local.get({
    actionType: 'block',
    language: 'ar'
  }, (data) => {
    actionTypeSelect.value = data.actionType;
    languageSelect.value = data.language;
  });

  // Save settings on change
  const saveSettings = () => {
    chrome.storage.local.set({
      actionType: actionTypeSelect.value,
      language: languageSelect.value
    });
  };

  actionTypeSelect.addEventListener('change', saveSettings);
  languageSelect.addEventListener('change', saveSettings);
});
