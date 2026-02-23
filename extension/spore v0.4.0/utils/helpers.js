// helpers.js - Pomocné funkce
window.SPORE_HELPERS = {
  sanitizeName(name) {
    return name.replace(/[^\w\s\-@.]/g, "").trim();
  },

  log(...args) {
    console.log("[SPORE]", ...args);
  },

  logDuplicate(action, cid, threadId) {
    console.log(`[SPORE] 🔄 ${action}: CID ${cid} ve vlákně ${threadId}`);
  },

  // Kontrola, jestli komentář už existuje v DOM před vložením
  commentExistsInDOM(container, cid) {
    if (!container || !cid) return false;
    const existing = container.querySelector(`[data-cid="${cid}"]`);
    if (existing) {
      this.logDuplicate("PŘESKOČEN - už existuje v DOM", cid, container.getAttribute('data-thread-id') || 'unknown');
      return true;
    }
    return false;
  },

  formatRelativeTime(ts) {
    if (!ts) return "";
    const now = Date.now();
    const t = new Date(ts).getTime();
    if (isNaN(t)) return "";
    const diffMin = Math.max(0, Math.floor((now - t) / 60000));

    if (diffMin < 1) return "1min";
    if (diffMin < 60) return `${diffMin}min`;

    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;

    return new Date(t).toLocaleString();
  },

  stripTrailingEmptyParas(html) {
    if (!html) return html;
    let s = String(html).trim();

    const emptyParaRe = /(?:<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>)+$/i;
    s = s.replace(emptyParaRe, "").trim();

    const emptyDivRe = /(?:<div>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>)+$/i;
    s = s.replace(emptyDivRe, "").trim();

    return s;
  },

  viewportW() {
    return document.documentElement.clientWidth || window.innerWidth || 0;
  },

  isFullscreenNow() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  },

  startLoading(button) {
    if (!button) return;
    button.disabled = true;
    button.style.cursor = "wait";
    const originalText = button.innerHTML;
    button.innerHTML = `⏳ Odesílám...`;
    return originalText;
  },

  stopLoading(button, originalText) {
    if (!button) return;
    button.disabled = false;
    button.style.cursor = "pointer";
    button.innerHTML = originalText;
  }
};