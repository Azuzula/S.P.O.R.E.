// auth.js - Autentifikace
class AuthManager {
    constructor() {
        this.accessToken = null;
        this.currentUser = null;
        this.onAuthChange = null;
    }

    async initOAuth() {
        window.SPORE_HELPERS.log("Spouštím OAuth2 tok (přes service worker)…");
        try {
            const response = await chrome.runtime.sendMessage({ action: "startOAuth" });

            if (response?.success && response.session) {
                this.accessToken = response.session.token;
                this.currentUser = response.session.user;
                window.SPORE_HELPERS.log("✅ Přihlášení úspěšné.");
                this.onAuthChange?.(this.accessToken, this.currentUser);
                return true;
            } else {
                console.error("[SPORE] Chyba při OAuth:", response?.error);
                return false;
            }
        } catch (e) {
            console.error("[SPORE] Chyba při komunikaci se Service Workerem:", e);
            return false;
        }
    }

    async logout() {
        window.SPORE_HELPERS.log("👋 Odhlášení (přes service worker)…");
        try {
            const response = await chrome.runtime.sendMessage({ action: "logout" });
            if (response?.success) {
                this.accessToken = null;
                this.currentUser = null;
                this.onAuthChange?.(null, null);
                return true;
            }
            return false;
        } catch (e) {
            console.error("[SPORE] Chyba při odhlašování:", e);
            return false;
        }
    }

    async getCurrentSession() {
        const response = await chrome.runtime.sendMessage({ action: "getCurrentSession" });
        if (response?.token) {
            this.accessToken = response.token;
            this.currentUser = response.user;
        }
        return { token: this.accessToken, user: this.currentUser };
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
            if (message.action === "oauthTokenUpdated") {
                this.accessToken = message.token;
                this.currentUser = message.user;
                window.SPORE_HELPERS.log("✅ Token aktualizován ze Service Workeru");
                this.onAuthChange?.(this.accessToken, this.currentUser);
                sendResponse({ success: true });
            } else if (message.action === "oauthLogout") {
                this.accessToken = null;
                this.currentUser = null;
                window.SPORE_HELPERS.log("👋 Odhlášeno Service Workerem");
                this.onAuthChange?.(null, null);
                sendResponse({ success: true });
            } else if (message.action === "ensureSession") {
                if (message.token) {
                    this.accessToken = message.token;
                    this.currentUser = message.user;
                    window.SPORE_HELPERS.log("✅ Session obnovena");
                } else {
                    this.accessToken = null;
                    this.currentUser = null;
                }
                this.onAuthChange?.(this.accessToken, this.currentUser);
            }
            return true;
        });
    }
}

window.AuthManager = AuthManager;