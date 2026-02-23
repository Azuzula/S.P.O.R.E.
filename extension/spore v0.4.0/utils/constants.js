// constants.js - Centralizované konstanty
window.SPORE_CONSTANTS = {
  API_URL: "https://s-p-o-r-e.onrender.com",
  FOLDER_NAME: "S.P.O.R.E.",
  EMOJIS: ["👍","💚","😂","😲","😢","🥱","🤬"],
  
  // Storage keys
  STORAGE_KEYS: {
    TOKEN: "google_token",
    USER: "google_user",
    POSITION: "sporeBtnPositionGlobal",
    LOGOUT_GUARD: "spore_logout_guard",
    CACHE_COMMENTS: "cached_comments"
  },
  
  // UI constants
  REFRESH_INTERVAL_MS: 55 * 60 * 1000, // 55 minut
  AUTOHIDE_MS: 2500,
  MOVE_THRESHOLD: 5,
  BUTTON_VISIBLE_WIDTH: 40
};