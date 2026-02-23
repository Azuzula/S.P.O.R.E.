// sanitizer.js - HTML sanitizace
window.SPORE_SANITIZER = {
  /**
   * Odstraní všechen HTML kód z textu - pro nadpisy před odesláním na server
   * @param {string} html - HTML text k vyčištění
   * @returns {string} - Čistý text bez HTML tagů
   */
  stripAllHTML(html) {
    if (!html) return '';
    
    // Vytvoříme dočasný element pro bezpečné odstranění HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Získáme jen textový obsah bez HTML tagů
    return temp.textContent || temp.innerText || '';
  },

  /**
   * Sanitizuje HTML pro bezpečné zobrazení v panelu - pro komentáře
   * @param {string} html - HTML text k sanitizaci
   * @returns {string} - Sanitizovaný HTML bezpečný pro zobrazení
   */
  sanitizeHTML(html) {
    // Zkusíme úplně minimalistickou konfiguraci
    const config = {
      ALLOWED_TAGS: ['p','strong','em','u','s','ol','ul','li','br','a','h1','h2','h3','img','span','div'],
      ALLOWED_ATTR: ['href','target','rel','src','alt','title','width','height','loading','referrerpolicy'],
      KEEP_CONTENT: true,
      RETURN_DOM: false
    };
    
    console.log('[SPORE] Sanitizuji HTML:', html.substring(0, 200));
    const result = DOMPurify.sanitize(html, config);
    console.log('[SPORE] Výsledek sanitizace:', result.substring(0, 200));
    
    return result;
  },

  addLazyLoadToImages(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('img').forEach(img => {
      if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
      if (!img.hasAttribute('referrerpolicy')) img.setAttribute('referrerpolicy', 'no-referrer');
    });
    return tmp.innerHTML;
  }
};