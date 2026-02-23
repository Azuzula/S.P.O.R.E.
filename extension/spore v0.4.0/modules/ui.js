// ui.js - UI komponenty a správa (bez import/export; bezpečné fallbacky + dual-export)

(function () {
    // --- Bezpečné fallbacky, kdyby někde chyběly namespaces ---
    window.SPORE_CONSTANTS = window.SPORE_CONSTANTS || {};
    window.SPORE_HELPERS   = window.SPORE_HELPERS   || {};
    window.SPORE_SANITIZER = window.SPORE_SANITIZER || {};
    window.SPORE_CACHE     = window.SPORE_CACHE     || {};
    window.SPORE_NS        = window.SPORE_NS        || {};

    const C = window.SPORE_CONSTANTS;
    const H = window.SPORE_HELPERS;
    const S = window.SPORE_SANITIZER;
    const Cache = window.SPORE_CACHE;

    // „no-op" fallbacky, aby content script nespadl, když se něco inituje později
    C.STORAGE_KEYS = C.STORAGE_KEYS || { POSITION: "sporeBtnPositionGlobal" };
    C.BUTTON_VISIBLE_WIDTH = typeof C.BUTTON_VISIBLE_WIDTH === "number" ? C.BUTTON_VISIBLE_WIDTH : 18;
    C.MOVE_THRESHOLD = typeof C.MOVE_THRESHOLD === "number" ? C.MOVE_THRESHOLD : 3;
    C.AUTOHIDE_MS = typeof C.AUTOHIDE_MS === "number" ? C.AUTOHIDE_MS : 2500;

    H.viewportW = H.viewportW || (() => window.innerWidth || document.documentElement.clientWidth || 1024);
    H.isFullscreenNow = H.isFullscreenNow || (() => !!(document.fullscreenElement || document.webkitFullscreenElement));
    H.formatRelativeTime = H.formatRelativeTime || (() => "");
    H.stripTrailingEmptyParas = H.stripTrailingEmptyParas || ((html) => html || "");

    S.sanitizeHTML = S.sanitizeHTML || ((html) => html || "");
    S.addLazyLoadToImages = S.addLazyLoadToImages || ((html) => html || "");
    S.stripAllHTML = S.stripAllHTML || ((html) => (html || "").replace(/<[^>]*>/g, ""));

    Cache.loadCache = Cache.loadCache || (async () => ({}));
    Cache.clearCache = Cache.clearCache || (async () => {});

    class UIManager {
        constructor(authManager, apiManager) {
            this.authManager = authManager;
            this.apiManager = apiManager;
            this.btn = null;
            this.panel = null;
            this.quill = null;
            this.replyEditors = new Map();
            this.replyTexts = new Map(); // Uložené texty editorů
            this.currentThreads = [];
	    this._fetchInFlight = null;   // hlídač paralelních fetchů

            // Fullscreen
            this.inFullscreen = false;
            this.edgeZone = null;
            this.hideTimer = null;

            // Drag
            this.dragging = false;
            this.moved = false;
            this.startX = 0;
            this.startY = 0;
            this.offsetX = 0;
            this.offsetY = 0;
        }

        init() {
            // Počkej, až bude <body>
            if (!document.body) {
                document.addEventListener("DOMContentLoaded", () => this.init(), { once: true });
                return;
            }
            this.createButton();
            this.createPanel();
            this.initializeQuill();
            this.setupEventListeners();
            this.loadSavedPosition();
            this.authManager.onAuthChange = (token) => {
                this.renderAuthSection();
                if (token) this.fetchAndRenderThreads();
            };
            
            // Načti uložené texty editorů
            this.loadReplyTexts();
        }

        createButton() {
            this.btn = document.createElement("div");
            this.btn.id = "sporeBtn";
            this.btn.innerHTML = `<img src="${chrome.runtime.getURL("icons/icon.svg")}" alt="🦠" style="width:40px;height:40px;pointer-events:none">`;
            this.btn.tabIndex = 0;
            this.btn.setAttribute("role", "button");
            document.body.appendChild(this.btn);
        }

        createPanel() {
            this.panel = document.createElement("div");
            this.panel.id = "sporePanel";
            this.panel.innerHTML = `
                <div id="sporeHeaderArea" style="margin-bottom:8px;"></div>
                <hr style="border-color:#004400; clear:both;">
                <div id="sporeEditorContainer">
                    Nadpis pro vlákno<br>
                    <div id="quillEditor" style="background:black;"></div>
                    <div id="charCounter" style="font-size:11px; color:#0a0; margin-top:4px;">
                        0 / 64 znaků
                    </div>
                    <div style="text-align:right; margin:5px 0;">
                        <button id="createThreadBtn" class="sporeButtons" style="float: right;">✳️ Zasít vlákno</button>
                    </div>
                </div>
                <div style="margin:8px 0;">
                    <button class="sporeButtons" id="refreshAllBtn">🔁 Obnovit komentáře</button>
                </div>
                <hr style="border-color:#004400; clear:both;">
		
                <div id="threadList"></div>
                    <hr style="border-color:#004400">
                </div>
                <div id="threadList"></div>
            `;
            const oldTransition = this.panel.style.transition;
            this.panel.style.transition = "none";
            this.panel.style.display = "block";
            this.panel.classList.add("sporeHidden");
            this.panel.getBoundingClientRect();
            this.panel.style.transition = oldTransition;
            document.body.appendChild(this.panel);
        }

        initializeQuill() {
            // Pokud Quill ještě není načten, zkus to později
            if (typeof window.Quill !== "function") {
                const again = () => this.initializeQuill();
                // malá prodleva (nezahltit)
                return setTimeout(again, 50);
            }

            this.quill = new Quill("#quillEditor", { 
                theme: "snow",
                modules: { toolbar: false }
            });

            const counterEl = document.getElementById("charCounter");
            this.quill.on("text-change", () => {
                const htmlContent = this.quill.root.innerHTML.trim();
                const cleanText = S.stripAllHTML(htmlContent);
                const length = cleanText.length;
                counterEl.textContent = `${length} / 64 znaků`;
                counterEl.style.color = length > 64 ? "red" : "#0a0";
            });
        }

        setupEventListeners() {
            this.setupButtonEvents();
            document.getElementById("createThreadBtn").onclick = () => this.createThread();
            document.getElementById("refreshAllBtn").onclick = () => this.refreshAll();

            document.addEventListener("fullscreenchange", () => this.onFullscreenChange());
            document.addEventListener("webkitfullscreenchange", () => this.onFullscreenChange());

            chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName === "local" && changes[C.STORAGE_KEYS.POSITION]) {
                    const newPos = JSON.parse(changes[C.STORAGE_KEYS.POSITION].newValue);
                    if (newPos) this.applySavedPosition(newPos);
                }
            });

            window.addEventListener("resize", async () => {
                if (this.inFullscreen) return;
                const saved = await chrome.storage.local.get(C.STORAGE_KEYS.POSITION);
                const pos = saved[C.STORAGE_KEYS.POSITION] ? JSON.parse(saved[C.STORAGE_KEYS.POSITION]) : null;
                if (pos) this.applySavedPosition(pos);
            });

            this.panel.addEventListener("mouseenter", () => { if (this.inFullscreen) clearTimeout(this.hideTimer); });
            this.panel.addEventListener("mouseleave", () => { if (this.inFullscreen) this.startAutoHideTimer(); });
            this.btn.addEventListener("mouseenter",   () => { if (this.inFullscreen) clearTimeout(this.hideTimer); });
            this.btn.addEventListener("mouseleave",   () => { if (this.inFullscreen) this.startAutoHideTimer(); });
        }

        setupButtonEvents() {
            this.btn.addEventListener("pointerdown", (e) => this.onPointerDown(e));
            this.btn.addEventListener("pointermove", (e) => this.onPointerMove(e));
            this.btn.addEventListener("pointerup",   (e) => this.onPointerUp(e));
            this.btn.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.togglePanel();
                }
            });
        }

        onPointerDown(e) {
            this.btn.setPointerCapture(e.pointerId);
            this.dragging = true;
            this.moved = false;
            this.startX = e.clientX;
            this.startY = e.clientY;
            const r = this.btn.getBoundingClientRect();
            this.offsetX = this.startX - r.left;
            this.offsetY = this.startY - r.top;
            this.btn.style.transition = "none";
        }

        onPointerMove(e) {
            if (!this.dragging) return;
            const dx = e.clientX - this.startX;
            const dy = e.clientY - this.startY;
            if (!this.moved && (Math.abs(dx) > C.MOVE_THRESHOLD || Math.abs(dy) > C.MOVE_THRESHOLD)) {
                this.moved = true;
            }
            if (this.moved) {
                document.body.style.userSelect = "none";
                this.btn.style.left = `${e.clientX - this.offsetX}px`;
                this.btn.style.top = `${e.clientY - this.offsetY}px`;
            }
        }

        async onPointerUp(e) {
            if (!this.dragging) return;
            this.btn.releasePointerCapture(e.pointerId);
            this.dragging = false;
            document.body.style.userSelect = "";

            if (!this.moved) {
                this.togglePanel();
                return;
            }

            const w = H.viewportW();
            const h = window.innerHeight;
            const r = this.btn.getBoundingClientRect();
            const snapLeft = r.left < w / 2;
            const vis = C.BUTTON_VISIBLE_WIDTH;
            const targetLeft = snapLeft ? -this.btn.offsetWidth + vis : w - vis;

            if (this.inFullscreen) this.updateEdgeZoneSide();

            this.btn.classList.toggle("sporeBtnFlip", snapLeft);
            const top = Math.max(0, Math.min(r.top, h - this.btn.offsetHeight));
            this.btn.style.transition = "left .6s cubic-bezier(.25,.8,.25,1), top .4s ease-out";
            this.btn.style.left = `${targetLeft}px`;
            this.btn.style.top = `${top}px`;

            setTimeout(async () => {
                await chrome.storage.local.set({
                    [C.STORAGE_KEYS.POSITION]: JSON.stringify({ 
                        side: snapLeft ? "left" : "right", 
                        top: this.btn.style.top 
                    })
                });
            }, 600);
        }

togglePanel() {
    const isDisplayed = this.panel.style.display === "block";
    const isHiddenBySlide = this.panel.classList.contains("sporeHidden");
    
    window.SPORE_HELPERS.log("🎛️ togglePanel - displayed:", isDisplayed, "hidden:", isHiddenBySlide);

    if (isDisplayed && !isHiddenBySlide) {
        window.SPORE_HELPERS.log("🔒 ZAVÍRÁM panel");
        this.panel.classList.add("sporeHidden");
        const onEnd = (e) => {
            if (e.propertyName !== "transform") return;
            this.panel.style.display = "none";
            this.panel.removeEventListener("transitionend", onEnd);
        };
        this.panel.addEventListener("transitionend", onEnd);
        if (this.inFullscreen) this.startAutoHideTimer();
        return;
    }

    // Otevíráme panel → obnov session + donačti vlákna/komentáře
    window.SPORE_HELPERS.log("🔓 OTEVÍRÁM panel");
    this.panel.style.display = "block";
    this.panel.getBoundingClientRect();
    this.panel.classList.remove("sporeHidden");

    // 1) Tichý refresh sessionu přes SW a promítnout do authManageru
    (async () => {
        try {
            const res = await new Promise(resolve => {
                chrome.runtime.sendMessage({ action: "ensureSession" }, resolve);
            });
            if (res && res.token) {
                this.authManager.accessToken = res.token;
                this.authManager.currentUser = res.user;
                this.authManager.onAuthChange?.(res.token, res.user);
            }
        } catch (e) {
            console.warn("[SPORE] ensureSession selhalo:", e);
        }

        // 2) Po otevření vždy zkus načíst vlákna inkrementálně
        try {
            // Pouze pokud už neběží renderování
            if (!this._renderInProgress) {
                await this.fetchAndRenderThreads();
            } else {
                window.SPORE_HELPERS.log("⚠️ Renderování už běží, přeskakuji fetchAndRenderThreads");
            }
        } catch (e) {
            console.warn("[SPORE] fetchAndRenderThreads při otevření panelu selhalo:", e);
        }
    })();
}

        async createThread() {
            const content = this.quill.root.innerHTML.trim();
            const createThreadBtn = document.getElementById("createThreadBtn");
            const originalText = this.startLoading(createThreadBtn, `⏳ Odesílám...`);
            try {
                await this.apiManager.createThread(content);
                this.quill.root.innerHTML = "";
                const counterEl = document.getElementById("charCounter");
                if (counterEl) counterEl.textContent = "0 / 64 znaků";
                await this.fetchAndRenderThreads();
            } catch (error) {
                alert(error.message);
            } finally {
                this.stopLoading(createThreadBtn, originalText);
            }
        }

        async addComment(threadMeta) {
            const ed = document.querySelector(`#editor_${threadMeta.id} .ql-editor`);
            const content = ed?.innerHTML.trim();
            const sb = document.querySelector(`#commentWrap_${threadMeta.id} .sporeButtons`);
            const originalText = this.startLoading(sb,`⏳ Odesílám...`);
            try {
                await this.apiManager.addComment(threadMeta, content);
                
                // Vyprázdni a zavři editor po úspěšném odeslání
                const replyQuill = this.replyEditors.get(threadMeta.id);
                if (replyQuill) {
                    replyQuill.root.innerHTML = "";
                    this.replyTexts.delete(threadMeta.id);
                    this.saveReplyTexts();
                }
                
                const wrap = document.querySelector(`#commentWrap_${threadMeta.id}`);
                if (wrap) {
                    this.replyEditors.delete(threadMeta.id);
                    wrap.remove();
                }
            } catch (error) {
                if (error.message !== "Komentář je prázdný") alert(error.message);
            } finally {
                this.stopLoading(sb, originalText);
                this.fetchAndRenderThreads();
            }
        }

// Tvrdý refresh: vyčistí DOM, cache i lokální stav a načte vše znovu
async refreshAll() {
    try {
        const refreshBtn = document.getElementById("refreshAllBtn");
        const originalText = this.startLoading(refreshBtn,`⏳ Načítám...`);
        
        // 1) Zastavit a zrušit případné reply editory
        try {
            this.replyEditors.forEach((q) => {
                if (q && typeof q.disable === "function") q.disable();
            });
        } catch (_) {}
        this.replyEditors.clear();

        // 2) Vyčistit DOM vláken
        const list = document.getElementById("threadList");
        if (list) list.innerHTML = "";

        // 3) Vyčistit lokální stav vláken
        this.currentThreads = [];

        // 4) Resetovat stavy vláken na výchozí (sbalené)
        await chrome.storage.local.remove('spore_thread_states');

        // 5) Vyčistit cache (ať se opravdu natáhne čerstvý obsah)
        await (window.SPORE_CACHE?.clearCache?.() ?? Promise.resolve());

        // 6) Stáhnout a vykreslit čerstvá vlákna+komentáře
        await this.fetchAndRenderThreads();
        
        this.stopLoading(refreshBtn, originalText);
    } catch (e) {
        console.error("[SPORE] Hard refresh selhal:", e);
        const refreshBtn = document.getElementById("refreshAllBtn");
        this.stopLoading(refreshBtn, "🔁 Obnovit komentáře");
        alert("Nepodařilo se obnovit komentáře. Zkus to prosím znovu.");
    }
}


async fetchAndRenderThreads() {
    // re-entrancy guard: když už běží, přilep se
    if (this._fetchInFlight) return this._fetchInFlight;
    
    window.SPORE_HELPERS.log("🚀 SPOUŠTÍM fetchAndRenderThreads");

    this._fetchInFlight = (async () => {
        const newThreads = await this.apiManager.fetchThreads();
        window.SPORE_HELPERS.log("📊 Načteno vláken:", newThreads.length);
        await this.renderThreads(newThreads);  // inkrementální vykreslení
        this.currentThreads = newThreads;
    })();

    try { 
        await this._fetchInFlight; 
        window.SPORE_HELPERS.log("✅ fetchAndRenderThreads DOKONČENO");
    } finally {
        this._fetchInFlight = null;
    }
}

        renderAuthSection() {
            const area = document.getElementById("sporeHeaderArea");
            const editorBlock = document.getElementById("sporeEditorContainer");
            const hr = this.panel.querySelector("hr");
            area.innerHTML = "";

            if (this.authManager.accessToken && this.authManager.currentUser) {
                const u = document.createElement("a");
                u.href = `https://spore.wtf/account?auth=${encodeURIComponent(this.authManager.currentUser.username)}&token=${encodeURIComponent(this.authManager.accessToken)}`;
                u.target = "_blank";
                u.style.color = "#9f9";
                u.style.textDecoration = "underline";
                u.textContent = `👤 ${this.authManager.currentUser.username}`;
                const lo = document.createElement("button");
                lo.className = "sporeButtons";
                lo.textContent = "Odhlásit";
                lo.style.cssText = "float:right; margin-left:8px;";
                lo.onclick = () => this.authManager.logout();
                area.append(u, lo);
                editorBlock.style.display = "";
                hr.style.display = "";
            } else {
                const logBtn = document.createElement("button");
                logBtn.textContent = "🔐 Přihlásit se";
                logBtn.className = "sporeButtons";
                logBtn.onclick = () => this.authManager.initOAuth();
                area.append(logBtn);
                editorBlock.style.display = "none";
                hr.style.display = "none";
            }
        }


async renderThreads(newThreads) {
    const list = document.getElementById("threadList");
    if (!list) return;
    
    const cache = await window.SPORE_CACHE.loadCache();

    for (const thread of newThreads) {
        const tid = String(thread.id);
        let existingBox = list.querySelector(`.threadBox[data-thread-id="${tid}"]`);
        let hadComments = 0;
        let hasNewComments = false;

        if (!existingBox) {
            existingBox = this.createThreadBox(thread);
            
            // Nastav počáteční stav vlákna
            const contentEl = existingBox.querySelector('.threadContent');
            const collapseIcon = existingBox.querySelector('.collapseIcon');
            const isExpanded = await this.loadThreadState(tid);
            
            if (!isExpanded) {
                contentEl.style.maxHeight = "0px";
                contentEl.style.opacity = "0";
                contentEl.style.display = "none";
                collapseIcon.style.transform = "rotate(-90deg)";
                collapseIcon.textContent = "▶";
            } else {
                contentEl.style.maxHeight = "none";
                contentEl.style.opacity = "1";
                contentEl.style.display = "block";
                collapseIcon.style.transform = "rotate(0deg)";
                collapseIcon.textContent = "▼";
            }
            
            list.append(existingBox);
        } else {
            // Spočítej kolik komentářů už bylo
            hadComments = existingBox.querySelectorAll('.commentPost[data-cid]').length;
        }

        const contentEl = existingBox.querySelector('.threadContent');
        if (!contentEl) continue;

        if (!this.authManager.accessToken) {
            if (!contentEl.querySelector('.orange')) {
                const info = document.createElement("div");
                info.classList.add("orange");
                info.style.margin = "8px 0";
                info.textContent = "🔒 Přihlas se prosím ke svému Google účtu pro zobrazení a psaní komentářů";
                contentEl.append(info);
            }
            continue;
        }

        // Získej všechny existující CID v tomto vlákně
        const existingDriveIds = new Set();
        contentEl.querySelectorAll('.commentPost[data-cid]').forEach(el => {
            const cid = el.getAttribute('data-cid');
            if (cid) existingDriveIds.add(cid);
        });
        
        window.SPORE_HELPERS.log(`📊 Vlákno ${tid}: nalezeno ${existingDriveIds.size} existujících komentářů (Drive ID):`, Array.from(existingDriveIds));

        // Aktualizuj počítadlo komentářů
        this.updateCommentCounter(existingBox, thread.comments?.length || 0);

        // Načti jen skutečně nové komentáře
        for (const cm of (thread.comments || [])) {
            if (cm.target_type !== "google_drive") continue;
            const driveId = String(cm.target_id);
            
            // Přímá kontrola v DOM - nejspolehlivější způsob
            const existingComment = contentEl.querySelector(`[data-cid="${driveId}"]`);
            if (existingComment) {
                window.SPORE_HELPERS.logDuplicate("PŘESKOČEN - už existuje v DOM", driveId, tid);
                continue;
            }
            
            // Označit, že máme nový komentář
            hasNewComments = true;
            
            try {
                const comment = await this.apiManager.getCommentById(driveId, cache);
                if (!comment) {
                    console.warn(`[SPORE] Komentář ${driveId} se nepodařilo načíst`);
                    continue;
                }
                
                // Ještě jedna kontrola těsně před vložením (pro jistotu)
                const doubleCheck = contentEl.querySelector(`[data-cid="${driveId}"]`);
                if (doubleCheck) {
                    window.SPORE_HELPERS.logDuplicate("PŘESKOČEN - objevil se mezitím", driveId, tid);
                    continue;
                }
                
                window.SPORE_HELPERS.logDuplicate("VKLÁDÁM nový komentář", driveId, tid);
                const postEl = this.createCommentElement(comment, driveId);
                
                // Vlož komentář před tlačítko "Odpovědět"
                const replyBtn = contentEl.querySelector('button.sporeButtons');
                if (replyBtn && replyBtn.textContent.includes("Odpovědět")) {
                    contentEl.insertBefore(postEl, replyBtn);
                } else {
                    contentEl.append(postEl);
                }
                
                // Aktualizuj počítadlo po přidání komentáře
                const currentCount = existingBox.querySelectorAll('.commentPost[data-cid]').length;
                this.updateCommentCounter(existingBox, currentCount);
            } catch (error) {
                console.error(`[SPORE] Chyba při načítání komentáře ${driveId}:`, error);
                
                // Kontrola před přidáním error elementu
                const errorCheck = contentEl.querySelector(`[data-cid="${driveId}"]`);
                if (errorCheck) {
                    window.SPORE_HELPERS.logDuplicate("PŘESKOČEN - error element už existuje", driveId, tid);
                    continue;
                }
                
                window.SPORE_HELPERS.logDuplicate("PŘIDÁVÁM error element", driveId, tid);
                const errBox = document.createElement("div");
                errBox.className = "commentPost";
                errBox.setAttribute("data-cid", driveId);
                errBox.innerHTML = `<div class="threadMeta red">⚠️ Komentář byl smazán autorem.</div>`;
                
                const replyBtn = contentEl.querySelector('button.sporeButtons');
                if (replyBtn && replyBtn.textContent.includes("Odpovědět")) {
                    contentEl.insertBefore(errBox, replyBtn);
                } else {
                    contentEl.append(errBox);
                }
                
                // I error komentář počítáme do celkového počtu
                const currentCount = existingBox.querySelectorAll('.commentPost[data-cid]').length;
                this.updateCommentCounter(existingBox, currentCount);
                
                // I error komentář počítáme jako "nový"
                hasNewComments = true;
            }
        }
        
        // Pokud se přidaly nové komentáře a vlákno bylo sbalené, rozbal ho
        if (hasNewComments && hadComments > 0) {
            const collapseIcon = existingBox.querySelector('.collapseIcon');
            const isCurrentlyCollapsed = contentEl.style.display === "none" || contentEl.style.maxHeight === "0px";
            
            if (isCurrentlyCollapsed) {
                window.SPORE_HELPERS.log(`🎉 Rozbaluji vlákno ${tid} kvůli novému komentáři`);
                this.expandThread(tid, existingBox, collapseIcon, contentEl);
            }
        }
        
        // Přidej tlačítko "Odpovědět" pokud ještě neexistuje a uživatel je přihlášen
        if (this.authManager.accessToken) {
            this.addReplyButton(thread, existingBox);
        }
    }
}


createThreadBox(thread) {
    const box = document.createElement("div");
    box.className = "threadBox";
    box.setAttribute("data-thread-id", String(thread.id));

            const metaEl = document.createElement("div");
            metaEl.className = "threadMeta";
            const tsStr = thread.created_at || thread.createdAt || null;
            const rel = H.formatRelativeTime(tsStr);
            const commentCount = (thread.comments || []).length;
            metaEl.innerHTML = `${thread.author || "Neznámý"}${rel ? " | " + rel : ""}<span class="commentCounter"> | (komentářů: ${commentCount})</span>`;
            if (tsStr) metaEl.title = new Date(tsStr).toLocaleString();
            box.append(metaEl);

            const titleEl = document.createElement("div");
            titleEl.className = "threadTitle";
            titleEl.textContent = thread.title || "";
            titleEl.style.cursor = "pointer";
            titleEl.title = "Klikni pro sbalení/rozbalení vlákna";
            
            // Přidej indikátor sbalení
            const collapseIcon = document.createElement("span");
            collapseIcon.className = "collapseIcon";
            collapseIcon.textContent = "▼";
            collapseIcon.style.cssText = "margin-right: 8px; transition: transform 0.2s ease; display: inline-block;";
            titleEl.prepend(collapseIcon);
            
            // Container pro obsah vlákna (komentáře + tlačítka)
            const contentEl = document.createElement("div");
            contentEl.className = "threadContent";
            contentEl.style.transition = "max-height 0.3s ease, opacity 0.2s ease";
            
            // Event listener pro sbalování
            titleEl.addEventListener("click", () => this.toggleThread(thread.id, box, collapseIcon, contentEl));
            
            box.append(titleEl, contentEl);

            return box;
        }

        async renderComments(thread, box, cache) {
            for (const commentMeta of thread.comments || []) {
                if (commentMeta.target_type !== "google_drive") {
                    console.warn("Nepodporovaný typ komentáře:", commentMeta.target_type);
                    continue;
                }
                try {
                    const cid = String(commentMeta.target_id);
			if (this.hasCommentDom(box, cid)) {
			    continue; // už existuje -> nepřidávat podruhé
			}
			const comment = await this.apiManager.getCommentById(cid, cache);
			const postEl = this.createCommentElement(comment, cid);
			box.append(postEl);
                } catch (e) {
                    	console.error("[SPORE] ❌ Chyba při načítání komentáře:", commentMeta, e);
                    	const errBox = document.createElement("div");
			errBox.className = "commentPost";
			errBox.innerHTML = `<div class="threadMeta red">⚠️ Komentář byl smazán autorem.</div>`;
			errBox.setAttribute("data-cid", cid);
			box.append(errBox);

                }
            }
        }

createCommentElement(comment, fallbackCid) {
    const postEl = document.createElement("div");
    postEl.className = "commentPost";
    // Použij Google Drive ID (fallbackCid) jako primární identifikátor
    const driveId = String(fallbackCid || comment?.fileId || comment?.gdriveId || comment?.id || "");
    if (driveId) {
        postEl.setAttribute("data-cid", driveId);
    } else {
        console.warn("[SPORE] Komentář nemá platné Drive ID:", comment);
    }

            const meta = document.createElement("div");
            meta.className = "threadMeta";
            const cts = comment.createdAt || comment.created_at || null;
            const crel = H.formatRelativeTime(cts);
            meta.textContent = `${comment.author || "Neznámý"}${crel ? " | " + crel : ""}`;
            if (cts) meta.title = new Date(cts).toLocaleString();

            const body = document.createElement("div");
            const rawHTML = H.stripTrailingEmptyParas(comment.content);
            const cleanHTML = S.sanitizeHTML(rawHTML);
            body.innerHTML = S.addLazyLoadToImages(cleanHTML);

            postEl.append(meta, body);
            return postEl;
        }

        addReplyButton(thread, box) {
            if (!this.authManager.accessToken) return;
            
            const contentEl = box.querySelector('.threadContent');
            if (!contentEl) return;
            
            // Zkontroluj, jestli už tlačítko "Odpovědět" neexistuje
            const existingReplyBtn = contentEl.querySelector('button.sporeButtons');
            if (existingReplyBtn && existingReplyBtn.textContent.includes("Odpovědět")) {
                window.SPORE_HELPERS.log("🔄 PŘESKOČEN - tlačítko Odpovědět už existuje ve vlákně", thread.id);
                return;
            }
            
            const repBtn = document.createElement("button");
            repBtn.textContent = "Odpovědět";
            repBtn.className = "sporeButtons";
            repBtn.onclick = () => this.toggleReplyEditor(thread, box);
            window.SPORE_HELPERS.log("➕ PŘIDÁVÁM tlačítko Odpovědět do vlákna", thread.id);
            contentEl.append(repBtn);
        }

        toggleReplyEditor(thread, box) {
            if (!this.authManager.accessToken) {
                alert("🔐 Přihlas se prosím ke svému Google účtu, ať můžeš psát komentáře.");
                return;
            }
            const contentEl = box.querySelector('.threadContent');
            if (!contentEl) return;
            
            const existing = contentEl.querySelector(`#commentWrap_${thread.id}`);
            if (existing) {
                // Ulož text před zavřením
                const replyQuill = this.replyEditors.get(thread.id);
                if (replyQuill) {
                    const content = replyQuill.root.innerHTML.trim();
                    if (content && content !== "<p><br></p>") {
                        this.replyTexts.set(thread.id, content);
                        this.saveReplyTexts();
                    }
                }
                this.replyEditors.delete(thread.id);
                existing.remove();
                return;
            }
            const wrap = document.createElement("div");
            wrap.id = `commentWrap_${thread.id}`;
            wrap.style.marginTop = "10px";
	    wrap.style.marginBottom = "25px";


            const ed = document.createElement("div");
            ed.id = `editor_${thread.id}`;
            ed.style.background = "black";

            const sb = document.createElement("button");
            sb.textContent = "Odeslat";
            sb.className = "sporeButtons";
            sb.style.cssText = "float:right; margin-top:5px;";
            sb.onclick = () => this.addComment(thread);

            wrap.append(ed, sb);
            contentEl.append(wrap);

            // Quill může být načtený opožděně na těžkých stránkách
            const initReply = () => {
                if (typeof window.Quill !== "function") return setTimeout(initReply, 50);
                const replyQuill = new Quill(`#editor_${thread.id}`, {
                    theme: "snow",
                    placeholder: "Napiš komentář…",
                    modules: {
                        toolbar: [
                            ["bold", "italic", "underline", "strike"],
                            [{ list: "ordered" }, { list: "bullet" }],
                            ["link"],
                            ["emoji"],
                            ["clean"]
                        ],
                        "emoji-toolbar": true,
                        "emoji-textarea": false,
                        "emoji-shortname": true
                    }
                });
                
                // Obnov uložený text
                const savedText = this.replyTexts.get(thread.id);
                if (savedText) {
                    replyQuill.root.innerHTML = savedText;
                }
                
                // Sleduj změny textu pro automatické ukládání
                replyQuill.on('text-change', () => {
                    const content = replyQuill.root.innerHTML.trim();
                    if (content && content !== "<p><br></p>") {
                        this.replyTexts.set(thread.id, content);
                        this.saveReplyTexts();
                    }
                });
                
                this.replyEditors.set(thread.id, replyQuill);
                
                // Scroll k editoru po vytvoření
                setTimeout(() => this.ensureEditorVisible(wrap), 100);
            };
            initReply();
        }

        onFullscreenChange() {
            this.inFullscreen = H.isFullscreenNow();
            if (this.inFullscreen) {
                this.createEdgeZone();
                this.hideSporeToEdge();
            } else {
                this.destroyEdgeZone();
                clearTimeout(this.hideTimer);
                this.hideTimer = null;
                const w = H.viewportW();
                const vis = C.BUTTON_VISIBLE_WIDTH;
                const isLeft = this.sideIsLeft();
                this.btn.classList.remove("sporeBtnHidden");
                this.btn.style.left = isLeft ? `${-this.btn.offsetWidth + vis}px` : `${w - vis}px`;
                this.panel.classList.remove("sporeHidden");
            }
        }

        createEdgeZone() {
            this.destroyEdgeZone();
            this.edgeZone = document.createElement("div");
            this.edgeZone.className = "sporeEdgeZone " + (this.sideIsLeft() ? "left" : "right");
            document.body.appendChild(this.edgeZone);
            this.edgeZone.addEventListener("mouseenter", () => this.showSporeFromEdge());
            this.edgeZone.addEventListener("mouseleave", () => this.startAutoHideTimer());
        }

        destroyEdgeZone() {
            if (this.edgeZone) {
                this.edgeZone.remove();
                this.edgeZone = null;
            }
        }

        hideSporeToEdge() {
            if (!this.inFullscreen) return;
            this.panel.classList.add("sporeHidden");
            this.btn.classList.add("sporeBtnHidden");
            const w = H.viewportW();
            const isLeft = this.sideIsLeft();
            this.btn.style.left = isLeft ? `${-this.btn.offsetWidth}px` : `${w}px`;
        }

        showSporeFromEdge() {
            const w = H.viewportW();
            const vis = C.BUTTON_VISIBLE_WIDTH;
            const isLeft = this.sideIsLeft();
            this.btn.classList.remove("sporeBtnHidden");
            this.btn.style.left = isLeft ? `${-this.btn.offsetWidth + vis}px` : `${w - vis}px`;
            if (this.panel.style.display === "block") {
                this.panel.classList.remove("sporeHidden");
            }
            this.startAutoHideTimer();
        }

        startAutoHideTimer() {
            if (!this.inFullscreen) return;
            clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
                if (
                    !this.btn.matches(":hover") && 
                    !this.panel.matches(":hover") && 
                    !(this.edgeZone?.matches && this.edgeZone.matches(":hover"))
                ) {
                    this.hideSporeToEdge();
                }
            }, C.AUTOHIDE_MS);
        }

        sideIsLeft() {
            return this.btn.classList.contains("sporeBtnFlip");
        }

        updateEdgeZoneSide() {
            if (!this.edgeZone) return;
            const left = this.sideIsLeft();
            this.edgeZone.classList.toggle("left", left);
            this.edgeZone.classList.toggle("right", !left);
        }

        async loadSavedPosition() {
            const saved = await chrome.storage.local.get(C.STORAGE_KEYS.POSITION);
            const pos = saved[C.STORAGE_KEYS.POSITION] ? JSON.parse(saved[C.STORAGE_KEYS.POSITION]) : null;
            if (pos) this.applySavedPosition(pos);
            setTimeout(() => {
                const w = H.viewportW();
                const l = this.btn.getBoundingClientRect().left;
                this.btn.classList.toggle("sporeBtnFlip", l < w / 2);
            }, 10);
        }

        applySavedPosition(pos) {
            const vis = C.BUTTON_VISIBLE_WIDTH;
            const old = this.btn.style.transition;
            this.btn.style.transition = "none";

            if (pos.side === "left") {
                this.btn.style.left = `${-this.btn.offsetWidth + vis}px`;
                this.btn.classList.add("sporeBtnFlip");
                if (this.inFullscreen) this.updateEdgeZoneSide();
            } else {
                this.btn.style.left = `${H.viewportW() - vis}px`;
                this.btn.classList.remove("sporeBtnFlip");
                if (this.inFullscreen) this.updateEdgeZoneSide();
            }

            const windowHeight = window.innerHeight;
            const buttonHeight = this.btn.offsetHeight;
            const savedTop = parseInt(pos.top, 10) || 0;
            const maxTop = windowHeight - buttonHeight;
            const newTop = Math.max(0, Math.min(savedTop, maxTop));
            this.btn.style.top = `${newTop}px`;

            setTimeout(() => this.btn.style.transition = old, 100);
        }

        startLoading(button, newText) {
            if (!button) return;
            button.disabled = true;
            button.style.cursor = "wait";
            const originalText = button.innerHTML;
            button.innerHTML = newText; //`⏳ Odesílám...`;
            return originalText;
        }

        stopLoading(button, originalText) {
            if (!button) return;
            button.disabled = false;
            button.style.cursor = "pointer";
            button.innerHTML = originalText;
        }
        
        // Zajistí, že editor je viditelný včetně tlačítka Odeslat
        ensureEditorVisible(editorWrap) {
            if (!editorWrap) return;
            
            const rect = editorWrap.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const buffer = 20; // Malý buffer pro lepší UX
            
            // Pokud je editor nebo jeho tlačítko mimo viewport
            if (rect.bottom > viewportHeight - buffer || rect.top < buffer) {
                editorWrap.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'end',  // Scroll tak, aby byl vidět i spodek (tlačítko Odeslat)
                    inline: 'nearest' 
                });
            }
        }
        
        // Uložení textů editorů do localStorage
        async saveReplyTexts() {
            try {
                const textsObj = {};
                this.replyTexts.forEach((text, threadId) => {
                    textsObj[threadId] = text;
                });
                await chrome.storage.local.set({ 
                    'spore_reply_texts': JSON.stringify(textsObj) 
                });
            } catch (e) {
                console.warn("[SPORE] Nepodařilo se uložit texty editorů:", e);
            }
        }
        
        // Načtení textů editorů z localStorage
        async loadReplyTexts() {
            try {
                const stored = await chrome.storage.local.get('spore_reply_texts');
                if (stored.spore_reply_texts) {
                    const textsObj = JSON.parse(stored.spore_reply_texts);
                    this.replyTexts.clear();
                    Object.entries(textsObj).forEach(([threadId, text]) => {
                        if (text && text.trim() && text !== "<p><br></p>") {
                            this.replyTexts.set(threadId, text);
                        }
                    });
                }
            } catch (e) {
                console.warn("[SPORE] Nepodařilo se načíst texty editorů:", e);
            }
        }
        
        toggleThread(threadId, box, collapseIcon, contentEl) {
            const isCollapsed = contentEl.style.maxHeight === "0px" || contentEl.style.display === "none";
            
            if (isCollapsed) {
                this.expandThread(threadId, box, collapseIcon, contentEl);
            } else {
                this.collapseThread(threadId, box, collapseIcon, contentEl);
            }
        }
        
        expandThread(threadId, box, collapseIcon, contentEl) {
            // Rozbal vlákno - slide down animace
            contentEl.style.display = "block";
            // Získej skutečnou výšku obsahu
            const scrollHeight = contentEl.scrollHeight;
            contentEl.style.maxHeight = "0px";
            // Trigger reflow
            contentEl.offsetHeight;
            // Animuj na skutečnou výšku
            contentEl.style.maxHeight = scrollHeight + "px";
            contentEl.style.opacity = "1";
            collapseIcon.style.transform = "rotate(0deg)";
            collapseIcon.textContent = "▼";
            
            // Po dokončení animace nastav na auto pro dynamický obsah
            setTimeout(() => {
                if (contentEl.style.maxHeight !== "0px") {
                    contentEl.style.maxHeight = "none";
                }
            }, 300);
            
            // Ulož stav do localStorage
            this.saveThreadState(threadId, true);
        }
        
        collapseThread(threadId, box, collapseIcon, contentEl) {
            // Sbal vlákno - slide up animace
            const scrollHeight = contentEl.scrollHeight;
            contentEl.style.maxHeight = scrollHeight + "px";
            // Trigger reflow
            contentEl.offsetHeight;
            // Animuj na 0
            contentEl.style.maxHeight = "0px";
            contentEl.style.opacity = "0";
            collapseIcon.style.transform = "rotate(-90deg)";
            collapseIcon.textContent = "▶";
            
            // Po dokončení animace skryj element úplně pro správný layout
            setTimeout(() => {
                if (contentEl.style.maxHeight === "0px") {
                    contentEl.style.display = "none";
                }
            }, 300);
            
            // Ulož stav do localStorage
            this.saveThreadState(threadId, false);
        }
        
        async saveThreadState(threadId, isExpanded) {
            try {
                const stored = await chrome.storage.local.get('spore_thread_states');
                const states = stored.spore_thread_states ? JSON.parse(stored.spore_thread_states) : {};
                states[threadId] = isExpanded;
                await chrome.storage.local.set({ 
                    'spore_thread_states': JSON.stringify(states) 
                });
            } catch (e) {
                console.warn("[SPORE] Nepodařilo se uložit stav vlákna:", e);
            }
        }
        
        async loadThreadState(threadId) {
            try {
                const stored = await chrome.storage.local.get('spore_thread_states');
                if (stored.spore_thread_states) {
                    const states = JSON.parse(stored.spore_thread_states);
                    return states[threadId] !== false; // Default je rozbalené
                }
                return false; // Default je SBALENÉ
            } catch (e) {
                console.warn("[SPORE] Nepodařilo se načíst stav vlákna:", e);
                return false; // Default je SBALENÉ
            }
        }
        
        updateCommentCounter(threadBox, count) {
            const counter = threadBox.querySelector('.commentCounter');
            if (counter) {
                counter.textContent = ` | (komentářů: ${count})`;
            }
        }
    }

    // --- Dual export pro jistotu (aby content.js vždy našel třídu) ---
    window.UIManager = UIManager;
    window.SPORE_NS.UIManager = UIManager;
})();