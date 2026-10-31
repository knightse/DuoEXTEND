// Per-page controller: load this website's saved mode, apply it, and answer the popup.
// Safari targets only the top frame when registering or manually injecting these scripts.
(() => {
    if (globalThis.duoExtendController) {
        return;
    }

    // The popup may inject helpers into a page that is already running them.
    // Keep a single controller, stylesheet owner and set of event listeners per page.
    globalThis.duoExtendController = true;

    const VALID_MODES = ['off', 'slight', 'full'];
    const DEFAULT_SETTING_KEY = 'default:width';
    const websiteSettingKey = `wide:${location.hostname.toLowerCase()}`;
    const pageLayout = createDuoLayout(document, window);

    let selectedMode = 'off';
    let websiteMode = 'inherit';
    let defaultMode = 'off';
    let isLayoutApplied = false;
    let hasStorageError = false;

    function updatePageLayout() {
        // An explicit website Off overrides an active global default.
        selectedMode = websiteMode === 'inherit' ? defaultMode : websiteMode;
        isLayoutApplied = pageLayout.apply(selectedMode);
    }

    function getCurrentState() {
        // A saved active mode does not guarantee that this particular page can expand.
        return {
            mode: selectedMode,
            siteMode: websiteMode,
            defaultMode,
            applied: isLayoutApplied,
            storageError: hasStorageError
        };
    }

    async function loadSavedMode() {
        try {
            const savedSettings = await browser.storage.local.get([websiteSettingKey, DEFAULT_SETTING_KEY]);
            defaultMode = duoMode(savedSettings[DEFAULT_SETTING_KEY]);
            websiteMode = savedSettings[websiteSettingKey] === undefined
                ? 'inherit' : duoMode(savedSettings[websiteSettingKey]);
            updatePageLayout();
        } catch {
            hasStorageError = true;
        }
    }

    // Requests wait for the initial read so the popup does not race a saved preference.
    const savedModeLoaded = loadSavedMode();

    async function handleModeRequest(message) {
        await savedModeLoaded;

        if (message.action === 'reset' || (message.action === 'set' && message.mode === 'inherit')) {
            // Removing an override resumes the global default; it does not mean Off.
            await browser.storage.local.remove(websiteSettingKey);
            websiteMode = 'inherit';
            hasStorageError = false;
            updatePageLayout();
        } else if (message.action === 'set') {
            if (!VALID_MODES.includes(message.mode)) {
                throw new Error('Invalid mode');
            }

            // Save first. A failed write must not be reported as a successful mode change.
            await browser.storage.local.set({ [websiteSettingKey]: message.mode });
            websiteMode = message.mode;
            hasStorageError = false;
            updatePageLayout();
        } else if (message.action !== 'get') {
            throw new Error('Unknown action');
        }

        return getCurrentState();
    }

    function handleRuntimeMessage(message) {
        if (!message || message.type !== 'duoextend') {
            // Do not claim messages intended for another extension context.
            return;
        }

        return handleModeRequest(message);
    }

    function handleStorageChange(changedSettings, storageArea) {
        if (storageArea !== 'local') {
            return;
        }

        const websiteChange = changedSettings[websiteSettingKey];
        const defaultChange = changedSettings[DEFAULT_SETTING_KEY];

        if (!websiteChange && !defaultChange) {
            return;
        }

        // Live tabs follow default changes only when they have no website override.
        if (websiteChange) {
            websiteMode = websiteChange.newValue === undefined
                ? 'inherit' : duoMode(websiteChange.newValue);
        }
        if (defaultChange) {
            defaultMode = duoMode(defaultChange.newValue);
        }
        hasStorageError = false;
        updatePageLayout();
    }

    browser.runtime.onMessage.addListener(handleRuntimeMessage);
    browser.storage.onChanged.addListener(handleStorageChange);

    // Recalculate for display changes and pages restored from browser history.
    window.addEventListener('resize', updatePageLayout);
    window.addEventListener('pageshow', updatePageLayout);
})();
