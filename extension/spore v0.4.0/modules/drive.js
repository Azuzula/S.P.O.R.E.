// drive.js - Google Drive operace
class DriveManager {
    constructor(authManager) {
        this.authManager = authManager;
        this.folderId = null;
    }

    async ensureFolder() {
        if (this.folderId) return this.folderId;
        
        window.SPORE_HELPERS.log("Kontroluji existenci složky", window.SPORE_CONSTANTS.FOLDER_NAME);
        const q = encodeURIComponent(`name='${window.SPORE_CONSTANTS.FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
        
        const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}`, {
            headers: { Authorization: `Bearer ${this.authManager.accessToken}` }
        }).then(r => r.json());

        if (listRes.files?.length) {
            this.folderId = listRes.files[0].id;
            window.SPORE_HELPERS.log("Existující složka ID =", this.folderId);
        } else {
            window.SPORE_HELPERS.log("Vytvářím složku", window.SPORE_CONSTANTS.FOLDER_NAME);
            const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.authManager.accessToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name: window.SPORE_CONSTANTS.FOLDER_NAME,
                    mimeType: "application/vnd.google-apps.folder"
                })
            }).then(r => r.json());
            
            this.folderId = createRes.id;
            window.SPORE_HELPERS.log("Vytvořené složky ID =", this.folderId);
        }
        return this.folderId;
    }

    async uploadToDrive(filename, data) {
        window.SPORE_HELPERS.log("uploadToDrive:", filename);
        await this.ensureFolder();
        
        const meta = {
            name: filename,
            mimeType: "application/json",
            parents: [this.folderId]
        };
        
        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
        form.append("file", new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename);
        
        const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
            method: "POST",
            headers: { Authorization: `Bearer ${this.authManager.accessToken}` },
            body: form
        });
        
        const json = await res.json();

        // Zveřejni soubor
        await fetch(`https://www.googleapis.com/drive/v3/files/${json.id}/permissions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.authManager.accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                role: "reader",
                type: "anyone"
            })
        });

        window.SPORE_HELPERS.log("✅ Soubor veřejně sdílen");
        return json;
    }
}

window.DriveManager = DriveManager;