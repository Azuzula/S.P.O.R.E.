// content.js - Hlavní content script
(async function() {
    "use strict";
    
    // Nezobrazuj ve vnořených rámcích (iframe)
    if (window.top !== window.self) {
        console.log("[SPORE] Running in iframe, exiting content script.");
        return;
    }

    // Nezobrazuj v popup oknech
    if (isPopupWindow()) {
        console.log("[SPORE] Running in popup window, exiting content script.");
        return;
    }

    // Inicializace emoji sprite fix
    initEmojiSpriteFix();

    // Inicializace managerů
    const authManager = new window.AuthManager();
    const driveManager = new window.DriveManager(authManager);
    const apiManager = new window.ApiManager(authManager, driveManager);
    const uiManager = new window.UIManager(authManager, apiManager);

    // Spuštění aplikace
    authManager.setupMessageListener();
    uiManager.init();
    
    // Načtení aktuální session
    await authManager.getCurrentSession();
    uiManager.renderAuthSection();

    function initEmojiSpriteFix() {
        const SPRITE_URL = chrome.runtime.getURL("1e7b63404cd2fb8e6525b2fd4ee4d286.png");
        const st = document.createElement("style");
        st.id = "spore-emoji-sprite-fix";
        st.textContent = `
            .ap { background-image: url("${SPRITE_URL}") !important; }
        `;
        document.documentElement.appendChild(st);
    }

    function isPopupWindow() {
        try {
            // Kontrola rozměrů okna - popup okna jsou obvykle menší
            const width = window.outerWidth || window.innerWidth;
            const height = window.outerHeight || window.innerHeight;
            
            // Popup okna jsou obvykle užší než 600px nebo nižší než 400px
            if (width < 600 || height < 400) {
                return true;
            }
            
            // Kontrola, jestli má okno toolbar, menubar, atd.
            // Popup okna obvykle nemají tyto prvky
            const hasMinimalUI = (
                !window.toolbar?.visible ||
                !window.menubar?.visible ||
                !window.locationbar?.visible ||
                !window.personalbar?.visible ||
                !window.scrollbars?.visible ||
                !window.statusbar?.visible
            );
            
            // Kontrola URL - některé popup okna mají specifické parametry
            const url = window.location.href;
            const isAuthPopup = (
                url.includes('oauth') ||
                url.includes('login') ||
                url.includes('auth') ||
                url.includes('signin') ||
                url.includes('popup') ||
                url.includes('dialog')
            );
            
            // Kontrola window.name - popup okna často mají specifické názvy
            const hasPopupName = (
                window.name.includes('popup') ||
                window.name.includes('auth') ||
                window.name.includes('login') ||
                window.name.includes('oauth')
            );
            
            // Kontrola window.opener - popup okna mají obvykle opener
            const hasOpener = !!window.opener;
            
            // Je to popup, pokud splňuje více kritérií
            const popupIndicators = [
                hasMinimalUI,
                isAuthPopup,
                hasPopupName,
                hasOpener
            ].filter(Boolean).length;
            
            return popupIndicators >= 2;
            
        } catch (e) {
            // Pokud se nepodaří detekovat, raději nezobrazuj
            console.warn("[SPORE] Popup detection failed:", e);
            return false;
        }
    }
})();