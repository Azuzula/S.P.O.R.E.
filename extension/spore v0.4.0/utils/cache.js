// cache.js - Správa cache
window.SPORE_CACHE = {
  async loadCache() {
    const stored = await chrome.storage.local.get(window.SPORE_CONSTANTS.STORAGE_KEYS.CACHE_COMMENTS);
    return stored[window.SPORE_CONSTANTS.STORAGE_KEYS.CACHE_COMMENTS] || {};
  },

  async saveCache(cache) {
    await chrome.storage.local.set({ 
      [window.SPORE_CONSTANTS.STORAGE_KEYS.CACHE_COMMENTS]: cache 
    });
  },

  async clearCache() {
    await chrome.storage.local.remove(window.SPORE_CONSTANTS.STORAGE_KEYS.CACHE_COMMENTS);
  }
};