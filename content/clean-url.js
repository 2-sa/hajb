// Runs in the page's MAIN world so X's clipboard writes can be cleaned in place.
(() => {
  const cleanText = (text) => {
    if (typeof text !== 'string') return text;
    return text.replace(/https?:\/\/[^\s<>"']+/gi, (candidate) => {
      try {
        const url = new URL(candidate);
        if (!/^(?:www\.|mobile\.)?(?:x\.com|twitter\.com)$/i.test(url.hostname) ||
            !/^\/(?:[A-Za-z0-9_]+\/status|i\/web\/status)\/\d+(?:\/|$)/.test(url.pathname)) return candidate;
        for (const key of [...url.searchParams.keys()]) {
          if (['a', 's', 't', 'ref_src', 'ref_url'].includes(key.toLowerCase()) || /^utm_/i.test(key)) {
            url.searchParams.delete(key);
          }
        }
        // Preserve the exact original text when there is nothing to remove.
        return url.search === new URL(candidate).search ? candidate : url.href;
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
      target && /^(TEXTAREA|INPUT)$/.test(target.tagName)
        ? target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? target.value.length)
        : globalThis.getSelection()?.toString()
    );
    const cleaned = cleanText(text);
    if (cleaned === text) return;
    event.clipboardData.setData('text/plain', cleaned);
    event.preventDefault();
  });
})();
