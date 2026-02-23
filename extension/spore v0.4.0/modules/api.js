// api.js - API komunikace
class ApiManager {
    constructor(authManager, driveManager) {
        this.authManager = authManager;
        this.driveManager = driveManager;
    }

    async createThread(content) {
        if (!this.authManager.accessToken) {
            throw new Error("Nejste přihlášeni");
        }

        if (!content.trim()) {
            throw new Error("Obsah vlákna je prázdný");
        }

        // Vyčistíme HTML z nadpisu před kontrolou délky a odesláním
        const cleanTitle = window.SPORE_SANITIZER.stripAllHTML(content).trim();
        
        if (cleanTitle.length > 64) {
            throw new Error("Nadpis vlákna smí mít maximálně 64 znaků");
        }
        
        if (!cleanTitle) {
            throw new Error("Nadpis vlákna nesmí být prázdný");
        }

        const timestamp = Date.now();
        const newThread = {
            id: `t_${timestamp}`,
            title: cleanTitle, // Používáme vyčištěný text
            url: location.href,
            domain: location.hostname,
            author: this.authManager.currentUser.username,
            email: this.authManager.currentUser.email,
            posts: [],
            created_at: new Date().toISOString()
        };

        window.SPORE_HELPERS.log("🪴 Zakládám vlákno:", newThread);

        const uploaded = await this.driveManager.uploadToDrive(`thread-${timestamp}.json`, newThread);
        
        const res = await fetch(`${window.SPORE_CONSTANTS.API_URL}/api/v2/create-thread`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                author: newThread.author,
                email: newThread.email,
                domain: newThread.domain,
                url: newThread.url,
                title: cleanTitle, // Odesíláme vyčištěný text
                target_type: "google_drive",
                target_id: uploaded.id
            })
        });

        const json = await res.json();
        if (!json.success) {
            throw new Error("Chyba při ukládání vlákna do databáze");
        }

        return json;
    }

    async addComment(threadMeta, content) {
        if (!this.authManager.accessToken) {
            throw new Error("Nejste přihlášeni");
        }

        if (!content?.trim() || content === "<p><br></p>") {
            throw new Error("Komentář je prázdný");
        }
        
        // Pro komentáře neodstraňujeme HTML - jen kontrolujeme základní validitu
        // HTML sanitizace se provede až při zobrazení v UI

        const timestamp = Date.now();
        const commentId = `p_${timestamp}`;
        const fileName = `comment-${threadMeta.id}-${timestamp}.json`;

        const newComment = {
            id: commentId,
            threadId: threadMeta.id,
            threadUrl: threadMeta.threadUrl || location.href,
            author: this.authManager.currentUser.username,
            email: this.authManager.currentUser.email,
            content,
            createdAt: new Date().toISOString()
        };

        window.SPORE_HELPERS.log("📝 Nový komentář:", newComment);

        const uploaded = await this.driveManager.uploadToDrive(fileName, newComment);

        const res = await fetch(`${window.SPORE_CONSTANTS.API_URL}/api/v2/add-comment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                thread_id: newComment.threadId,
                author: newComment.author,
                email: newComment.email,
                target_type: "google_drive",
                target_id: uploaded.id,
                created_at: newComment.createdAt,
                parent_comment_id: null
            })
        });

        const json = await res.json();
        window.SPORE_HELPERS.log("🧾 Odpověď backendu /api/v2/add-comment:", json);
        return json;
    }

    async fetchThreads() {
        window.SPORE_HELPERS.log("fetchThreads v2 pro URL", location.href);
        const apiRes = await fetch(`${window.SPORE_CONSTANTS.API_URL}/api/v2/get-threads?url=${encodeURIComponent(location.href)}`)
            .then(r => r.json());

        if (!apiRes.threads) {
            window.SPORE_HELPERS.log("Žádná vlákna nenalezena");
            return [];
        }

        return apiRes.threads.map(t => ({
            id: t.id,
            title: t.title,
            domain: t.domain,
            url: t.url,
            author: t.author || "Neznámý",
            email: t.email || "",
            created_at: t.created_at || t.createdAt || null,
            posts: [],
            drive_url: null,
            comments: t.comments.map(c => ({
                id: c.id,
                author: c.author,
                email: c.email,
                created_at: c.created_at,
                target_type: c.target_type,
                target_id: c.target_id
            })),
            error: false
        }));
    }

    async getCommentById(id, cache) {
        if (cache[id]) {
            window.SPORE_HELPERS.log("🟢 NAČÍTÁM Z CACHE:", id);
            return cache[id];
        }

        window.SPORE_HELPERS.log("🔄 STAHUJU Z DRIVE:", id);
        const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: "fetchPublicDriveFile", fileId: id }, resolve);
        });

        if (response.success) {
            try {
                const comment = JSON.parse(response.content);
                cache[id] = comment;
                await window.SPORE_CACHE.saveCache(cache);
                window.SPORE_HELPERS.log("✅ ULOŽENO DO CACHE:", id);
                return comment;
            } catch (e) {
                console.warn("[SPORE] ❌ JSON parse error:", id, e);
                return null;
            }
        } else {
            console.warn("[SPORE] ❌ Chyba při načítání komentáře:", id, response.error);
            return null;
        }
    }
}

window.ApiManager = ApiManager;