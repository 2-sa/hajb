// Runs in the page's MAIN world so X's clipboard writes can be cleaned in place.
(() => {
  const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
  const FAST_HOST_HINT = /(?:x|twitter)\.com/i;
  const SUPPORTED_HOST = /^(?:www\.|mobile\.|pro\.)?(?:x\.com|twitter\.com)$/i;
  const SUPPORTED_POST_PATH = /^\/(?:[A-Za-z0-9_]+\/status|i\/web\/status)\/\d+(?:\/|$)/i;
  const TRACKING_PARAMS = new Set(['a', 's', 't', 'ref_src', 'ref_url']);
  const UTM_PARAM = /^utm_/i;
  const TEXT_INPUT_TAGS = /^(TEXTAREA|INPUT)$/;

  const cleanText = (text) => {
    if (typeof text !== 'string' || !text.includes('?') || !FAST_HOST_HINT.test(text)) return text;
    return text.replace(URL_PATTERN, (candidate) => {
      if (!candidate.includes('?')) return candidate;
      try {
        const url = new URL(candidate);
        if (!SUPPORTED_HOST.test(url.hostname) || !SUPPORTED_POST_PATH.test(url.pathname)) return candidate;
        let toDelete = null;
        for (const key of url.searchParams.keys()) {
          if (TRACKING_PARAMS.has(key.toLowerCase()) || UTM_PARAM.test(key)) {
            if (!toDelete) toDelete = [];
            toDelete.push(key);
          }
        }
        if (!toDelete) return candidate;
        for (const key of toDelete) url.searchParams.delete(key);
        return url.href;
      } catch {
        return candidate;
      }
    });
  };

  const clipboard = navigator.clipboard;
  if (clipboard?.writeText) {
    const originalWriteText = clipboard.writeText;
    clipboard.writeText = function (text) {
      return Reflect.apply(originalWriteText, this, [cleanText(text)]);
    };
  }

  // Also cover X versions that copy via a temporary textarea and execCommand.
  document.addEventListener('copy', (event) => {
    if (!event.clipboardData) return;
    const target = document.activeElement;
    const text = event.clipboardData.getData('text/plain') || (
      target && TEXT_INPUT_TAGS.test(target.tagName)
        ? target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? target.value.length)
        : globalThis.getSelection()?.toString()
    );
    const cleaned = cleanText(text);
    if (cleaned === text) return;
    event.clipboardData.setData('text/plain', cleaned);
    event.preventDefault();
  });
})();
