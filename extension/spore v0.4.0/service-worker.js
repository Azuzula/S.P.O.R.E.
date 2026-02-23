// service-worker.js
let currentAccessToken = null;
let currentUserInfo = null;
let refreshTimeoutId = null;

/**
 * Odešle zprávu všem aktivním content scriptům.
 * @param {object} message - Objekt zprávy k odeslání.
 */
async function notifyContentScripts(message) {
    console.log("[SPORE] Notifikuji content skripty:", message);
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
        if (tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
            try {
                await chrome.tabs.sendMessage(tab.id, message);
            } catch (error) {
                // Může dojít k chybě, pokud content script není načten nebo tab byl zavřen
            }
        }
    }
}

/**
 * Získá Google Access Token pomocí chrome.identity API.
 * @param {boolean} interactive - true pro zobrazení přihlašovacího okna, false pro tichý režim.
 * @returns {Promise<{token: string, user: object}|null>} Token a info o uživateli, nebo null při chybě.
 */
async function getGoogleAuthToken(interactive) {
    console.log(`[SPORE] Získávám token (interaktivní: ${interactive})...`);
    try {
        const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: interactive }, (token) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError.message);
                }
                resolve(token);
            });
        });

        if (!token) {
            console.log("[SPORE] Token nebyl získán.");
            return null;
        }

        console.log("[SPORE] Token získán. Načítám info o uživateli...");
        const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!userInfoRes.ok) {
            throw new Error(`Failed to fetch user info: HTTP ${userInfoRes.status}`);
        }
        const user = await userInfoRes.json();

        // Sanitizace jména
        const sanitizedName = user.name?.replace(/[^\w\s\-@.]/g, "").trim() || user.given_name?.replace(/[^\w\s\-@.]/g, "").trim() || "Neznámý";

        // Uložení tokenu a user info do chrome.storage.local
        await chrome.storage.local.set({
            "google_token": token,
            "google_user": {
                username: sanitizedName,
                email: user.email
            }
        });

        currentAccessToken = token;
        currentUserInfo = {
            username: sanitizedName,
            email: user.email
        };

        console.log("[SPORE] ✅ Přihlášen uživatel:", currentUserInfo);

        // Zaregistruj uživatele na backendu
        await fetch("https://s-p-o-r-e.onrender.com/register-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentUserInfo)
        }).then(r => r.json()).then(res => console.log("[SPORE] Register-user odpověď:", res))
          .catch(e => console.error("[SPORE Service Worker] Chyba při registraci uživatele:", e));

        // Notifikuj všechny aktivní content skripty o aktualizaci tokenu
        await notifyContentScripts({ action: "oauthTokenUpdated", token: currentAccessToken, user: currentUserInfo });

        // Naplánuj tichý refresh
        scheduleSilentRefresh();

        return { token: currentAccessToken, user: currentUserInfo };

    } catch (error) {
        console.error("[SPORE Service Worker] Chyba při získávání tokenu:", error);
        await clearSession();
        return null;
    }
}

/**
 * Odstraní aktuální token z prohlížeče a vymaže uloženou session.
 */
async function clearSession() {
    console.log("[SPORE] Odhlašování uživatele a čištění session...");

    try {
        // 1) Revoke access token (server-side)
        if (currentAccessToken) {
            try {
                await fetch("https://oauth2.googleapis.com/revoke", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({ token: currentAccessToken })
                });
            } catch (e) {
                console.warn("[SPORE Service Worker] Revoke token failed (non-fatal):", e?.message || e);
            }
        }

        // 2) Vyprázdnit cache tokenů v prohlížeči
        await new Promise(resolve => {
            chrome.identity.clearAllCachedAuthTokens(() => {
                if (chrome.runtime.lastError) {
                    console.warn("[SPORE Service Worker] clearAllCachedAuthTokens:", chrome.runtime.lastError.message);
                }
                resolve();
            });
        });

        // 3) Pro jistotu odstranit případný "aktuální" token z cache
        if (currentAccessToken) {
            await new Promise(resolve => {
                chrome.identity.removeCachedAuthToken({ token: currentAccessToken }, () => resolve());
            });
        }

        // 4) Smazat data v chrome.storage
        await chrome.storage.local.remove([
            "google_token", 
            "google_user", 
            "cached_comments"
        ]);

        // 5) Nastavit logout guard
        await chrome.storage.local.set({ "spore_logout_guard": true });

        // 6) Vyčistit runtime stav
        currentAccessToken = null;
        currentUserInfo = null;
        if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
        refreshTimeoutId = null;

        // 7) Notifikovat content skripty
        await notifyContentScripts({ action: "oauthLogout" });

        console.log("[SPORE] 👋 Uživatel odhlášen, session vyčištěna.");
    } catch (e) {
        console.error("[SPORE Service Worker] clearSession error:", e);
    }
}

/**
 * Obnoví token na pozadí bez zobrazení přihlašovacího okna.
 */
async function scheduleSilentRefresh() {
    if (refreshTimeoutId) {
        clearTimeout(refreshTimeoutId);
        refreshTimeoutId = null;
    }

    if (!currentAccessToken) {
        console.log("[SPORE] Žádný token k obnovení, tichý refresh se nespustí.");
        return;
    }

    console.log(`[SPORE] Plánuji tichý refresh tokenu za ${55} minut.`);
    refreshTimeoutId = setTimeout(async () => {
        console.log("[SPORE] 🔄 Spouštím tichý refresh tokenu...");
        await getGoogleAuthToken(false);
    }, 55 * 60 * 1000);
}

// Zpracování zpráv z Content Scriptu
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startOAuth") {
        chrome.storage.local.remove("spore_logout_guard", () => {});
        getGoogleAuthToken(true)
            .then(session => sendResponse({ success: true, session }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    } else if (request.action === "logout") {
        clearSession()
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    } else if (request.action === "getCurrentSession") {
        sendResponse({ token: currentAccessToken, user: currentUserInfo });
        return false;
    } else if (request.action === "ensureSession") {
        (async () => {
            const stored = await chrome.storage.local.get(["spore_logout_guard"]);
            const hardLoggedOut = !!stored["spore_logout_guard"];

            if (currentAccessToken) {
                sendResponse({ token: currentAccessToken, user: currentUserInfo });
                return;
            }

            if (hardLoggedOut) {
                sendResponse({ token: null });
                return;
            }

            const session = await getGoogleAuthToken(false);
            if (session?.token) {
                sendResponse({ token: session.token, user: session.user });
            } else {
                sendResponse({ token: null });
            }
        })();
        return true;
    } else if (request.action === "fetchPublicDriveFile" && request.fileId) {
        const fileUrl = `https://drive.google.com/uc?export=download&id=${request.fileId}`;
        console.log("[SPORE:SW] 🔎 fetchPublicDriveFile", request.fileId, fileUrl);

        fetch(fileUrl)
            .then(async res => {
                console.log("[SPORE:SW] HTTP status", res.status);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const text = await res.text();
                console.log("[SPORE:SW] body preview:", text.slice(0, 300));
                return text;
            })
            .then(text => sendResponse({ success: true, content: text }))
            .catch(err => {
                console.error("[SPORE:SW] fetch error:", err?.message || err);
                sendResponse({ success: false, error: err.message });
            });

        return true;
    }
});

// Inicializace Service Workeru
(async () => {
    console.log("[SPORE] Service Worker inicializace...");
    const stored = await chrome.storage.local.get(["google_token", "google_user"]);
    if (stored["google_token"] && stored["google_user"]) {
        currentAccessToken = stored["google_token"];
        currentUserInfo = stored["google_user"];
        console.log("[SPORE] Rehydratováno ze storage:", currentUserInfo);

        await getGoogleAuthToken(false);
    } else {
        console.log("[SPORE] Žádná uložená session nalezena.");
    }
})();