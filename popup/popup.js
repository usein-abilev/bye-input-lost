document.addEventListener("DOMContentLoaded", () => {
    const notifyToggle = document.getElementById("notifyToggle");
    const draftListEl = document.getElementById("draftList");
    const clearAllBtn = document.getElementById("clearAll");

    chrome.storage.local.get("bye_input_lost_settings", (result) => {
        notifyToggle.checked = result["bye_input_lost_settings"]?.notificationsEnabled === true;
    });

    notifyToggle.addEventListener("change", () => {
        chrome.storage.local.set({ "bye_input_lost_settings": { notificationsEnabled: notifyToggle.checked } });
    });

    function getCurrentDomain() {
        return new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                try {
                    const url = tabs?.[0]?.url ? new URL(tabs[0].url) : null;
                    resolve(url?.hostname ?? null);
                } catch {
                    resolve(null);
                }
            });
        });
    }

    function getCurrentTabId() {
        return new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                resolve(tabs?.[0]?.id ?? null);
            });
        });
    }

    function getDomainEntries() {
        return new Promise(async (resolve) => {
            const currentDomain = await getCurrentDomain();
            chrome.storage.local.get(null, (result) => {
                const entries = Object.entries(result).filter(([key]) => {
                    if (!key.startsWith("bye_input_lost_") || key === "bye_input_lost_settings") return false;
                    return key.replace("bye_input_lost_", "") === currentDomain;
                });
                resolve(entries);
            });
        });
    }

    function createDraftHtml(key, data) {
        const url = data.url || "Unknown URL";
        const time = data.timestamp ? new Date(data.timestamp).toLocaleString() : "Unknown";
        const inputCount = data.inputs?.length ?? 0;
        const preview = data.inputs?.[0]?.value?.substring(0, 100) ?? "";

        return `
            <div class="draft-item" data-key="${key}">
                <div class="draft-url" title="${escapeHtml(url)}">${escapeHtml(url)}</div>
                <div class="draft-preview">${escapeHtml(preview)}</div>
                <div class="draft-meta">${inputCount} input${inputCount !== 1 ? "s" : ""} &#903; ${time}</div>
                <div class="draft-actions">
                    <button class="draft-btn draft-restore" data-action="restore" data-key="${key}">Restore</button>
                    <button class="draft-btn draft-remove" data-action="remove" data-key="${key}">Remove</button>
                </div>
            </div>`;
    }

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    async function handleAction(action, key) {
        if (action === "remove") {
            chrome.storage.local.remove(key, renderDrafts);
        } else if (action === "restore") {
            const result = await new Promise((resolve) => {
                chrome.storage.local.get(key, (r) => resolve(r[key]));
            });
            if (result?.inputs) {
                const tabId = await getCurrentTabId();
                if (tabId) {
                    chrome.tabs.sendMessage(tabId, { action: "restoreDraft", data: result }, (response) => {
                        if (response?.restored) {
                            chrome.storage.local.remove(key, renderDrafts);
                        }
                    });
                }
            }
        }
    }

    async function renderDrafts() {
        const entries = await getDomainEntries();

        if (entries.length === 0) {
            draftListEl.innerHTML = `<div class="empty">No saved drafts for this page</div>`;
            clearAllBtn.style.display = "none";
            return;
        }

        clearAllBtn.style.display = "block";
        draftListEl.innerHTML = entries.map(([key, data]) => createDraftHtml(key, data)).join("");

        draftListEl.querySelectorAll(".draft-btn").forEach((btn) => {
            btn.addEventListener("click", () => handleAction(btn.dataset.action, btn.dataset.key));
        });
    }

    renderDrafts();

    clearAllBtn.addEventListener("click", async () => {
        const entries = await getDomainEntries();
        const keys = entries.map(([key]) => key);
        chrome.storage.local.remove(keys, renderDrafts);
    });
});
