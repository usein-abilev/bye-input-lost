(function() {
    const TRACKED_TYPES = ["text", "search", "tel", "url", "number"];
    const STORAGE_KEY_PREFIX = "bye_input_lost_";
    const DEBOUNCE_DELAY = 500;

    let saveTimeout = null;
    const trackedInputs = [];
    const domain = window.location.hostname;
    const storageKey = STORAGE_KEY_PREFIX + domain;

    function getSelector(element) {
        if (element.id) {
            return "#" + CSS.escape(element.id);
        }

        let path = [];
        while (element && element.nodeType === Node.ELEMENT_NODE) {
            let selector = element.tagName.toLowerCase();
            if (element.id) {
                selector += "#" + CSS.escape(element.id);
                path.unshift(selector);
                break;
            } else {
                let sib = element, nth = 1;
                while (sib = sib.previousElementSibling) {
                    if (sib.tagName === element.tagName) nth++;
                }
                if (nth > 1) {
                    selector += `:nth-of-type(${nth})`;
                }
            }
            path.unshift(selector);
            element = element.parentNode;
        }
        return path.join(" > ");
    }

    function isTrackableInput(element) {
        if (element.isContentEditable) return true;
        if (element.tagName === "TEXTAREA") return true;
        if (element.tagName === "INPUT") {
            const type = element.type.toLowerCase();
            if (type === "password") return false;
            if (type === "email") return false;
            if (TRACKED_TYPES.includes(type)) return true;
        }
        return false;
    }

    function getAllTrackableInputs() {
        const inputs = document.querySelectorAll("input, textarea, [contenteditable]");
        return Array.from(inputs).filter(isTrackableInput);
    }

    function collectInputData() {
        const inputs = getAllTrackableInputs();
        const data = [];

        inputs.forEach(input => {
            let value = "";
            if (input.isContentEditable) {
                value = input.innerText || input.textContent || "";
            } else {
                value = input.value || "";
            }

            if (value.trim()) {
                data.push({
                    selector: getSelector(input),
                    value: value,
                    isContentEditable: input.isContentEditable || false
                });
            }
        });

        return data;
    }

    function saveToStorage() {
        const data = collectInputData();
        if (data.length === 0) return;

        const storageData = {
            inputs: data,
            timestamp: Date.now(),
            url: window.location.href
        };

        chrome.storage.local.set({ [storageKey]: storageData }, () => {
            console.log("[Bye Input Lost] Saved", data.length, "inputs", { storageKey, storageData });
        });
    }

    function debouncedSave() {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        saveTimeout = setTimeout(saveToStorage, DEBOUNCE_DELAY);
    }

    function createNotification(savedData) {
        const existing = document.querySelector(".bye-input-lost-notification");
        if (existing) existing.remove();

        const notification = document.createElement("div");
        notification.className = "bye-input-lost-notification";

        const inputCount = savedData.inputs.length;
        const text = inputCount === 1
            ? "We saved your draft (1 input)"
            : `We saved your drafts (${inputCount} inputs)`;

        notification.innerHTML = `
      <div class="bye-input-lost-content">
        <span class="bye-input-lost-text">${text}</span>
      </div>
      <div class="bye-input-lost-actions">
        <button class="bye-input-lost-btn bye-input-lost-restore">Restore</button>
        <button class="bye-input-lost-btn bye-input-lost-discard">Discard</button>
      </div>
    `;

        document.body.appendChild(notification);

        notification.querySelector(".bye-input-lost-restore").addEventListener("click", () => {
            removeNotification();
            const restored = restoreInputs(savedData);
            if (restored) {
                clearStorage();
            }
        });

        notification.querySelector(".bye-input-lost-discard").addEventListener("click", () => {
            removeNotification();
            clearStorage();
        });
    }

    function removeNotification() {
        const notification = document.querySelector(".bye-input-lost-notification");
        if (notification) {
            notification.classList.add("bye-input-lost-hiding");
            setTimeout(() => notification.remove(), 300);
        }
    }

    function restoreInputs(savedData) {
        let restored = false;

        console.log("[Bye Input Lost] Starting restore with data:", savedData);

        savedData.inputs.forEach(savedInput => {
            console.log("[Bye Input Lost] Trying selector:", savedInput.selector);
            let elements = document.querySelectorAll(savedInput.selector);
            console.log("[Bye Input Lost] Found elements:", elements.length);

            if (elements.length === 0) {
                return;
            }

            elements.forEach(el => {
                console.log("[Bye Input Lost] Restoring to element:", el);
                if (savedInput.isContentEditable || el.isContentEditable) {
                    el.innerText = savedInput.value;
                    el.textContent = savedInput.value;
                } else {
                    el.value = savedInput.value;
                    console.log("[Bye Input Lost] Set value to:", savedInput.value);
                }
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));

                el.focus();
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                restored = true;
            });
        });

        return restored;
    }

    function clearStorage() {
        chrome.storage.local.remove(storageKey, () => {
            console.log("[Bye Input Lost] Cleared storage for", domain);
        });
    }

    function checkSavedData() {
        chrome.storage.local.get(["bye_input_lost_settings", storageKey], (result) => {
            const settings = result["bye_input_lost_settings"] || {};
            const savedData = result[storageKey];

            if (settings.notificationsEnabled !== true) {
                return;
            }

            if (savedData && savedData.inputs && savedData.inputs.length > 0) {
                setTimeout(() => {
                    createNotification(savedData);
                }, 100);
            }
        });
    }

    function setupInputListeners() {
        const inputs = getAllTrackableInputs();

        inputs.forEach(input => {
            if (!trackedInputs.includes(input)) {
                trackedInputs.push(input);

                input.addEventListener("input", debouncedSave);
                input.addEventListener("paste", debouncedSave);
                input.addEventListener("cut", debouncedSave);
            }
        });
    }

    function init() {
        setupInputListeners();
        checkSavedData();

        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === "restoreDraft" && message.data) {
                setTimeout(() => {
                    const restored = restoreInputs(message.data);
                    if (restored) {
                        clearStorage();
                    }
                    sendResponse({ success: true, restored });
                }, 100);
                return true;
            }
        });

        const observer = new MutationObserver((mutations) => {
            let shouldCheck = false;
            mutations.forEach(mutation => {
                if (mutation.addedNodes.length > 0) {
                    shouldCheck = true;
                }
            });
            if (shouldCheck) {
                setupInputListeners();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
