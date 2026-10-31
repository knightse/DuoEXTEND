// Safari popup: display the current page's state and handle explicit user choices.
const modeSelect = document.querySelector('#mode');
const statusText = document.querySelector('#status');
const helpText = document.querySelector('#help');
const websiteName = document.querySelector('#site');
const allowAccessButton = document.querySelector('#allow');

const defaultModeSelect = document.querySelector('#default-mode');
const defaultStatusText = document.querySelector('#default-status');
const allowAllButton = document.querySelector('#allow-all');
const DEFAULT_SETTING_KEY = 'default:width';
const ALL_WEBSITE_PATTERNS = ['http://*/*', 'https://*/*'];

const VALID_MODES = ['off', 'slight', 'full'];

let defaultMode = 'off';
let hasAllWebsiteAccess = false;
let activeTabId;
let websitePermissionPatterns;
let isUpdating = false;
let hasWebsiteAccess = false;

function normalizeSavedMode(savedValue) {
    // Preserve the first prototype's setting without keeping its overly wide default.
    if (savedValue === true) {
        return 'slight';
    }

    if (VALID_MODES.includes(savedValue)) {
        return savedValue;
    }

    return 'off';
}

function hasValidModeResponse(response) {
    return response && VALID_MODES.includes(response.mode)
        && [...VALID_MODES, 'inherit'].includes(response.siteMode)
        && VALID_MODES.includes(response.defaultMode);
}

async function requestPageState(action, selectedMode) {
    const message = {
        type: 'duoextend',
        action,
        mode: selectedMode
    };

    let response;

    try {
        response = await browser.tabs.sendMessage(activeTabId, message);
    } catch {
        // A page opened before extension activation may not have a controller yet.
    }

    if (hasValidModeResponse(response)) {
        return response;
    }

    // Safari can also resolve a missing receiver with no value. Load the layout helper
    // first, then the controller, and retry the same explicit request once.
    for (const scriptFile of ['layout.js', 'content.js']) {
        await browser.scripting.executeScript({
            target: { tabId: activeTabId },
            files: [scriptFile]
        });
    }

    response = await browser.tabs.sendMessage(activeTabId, message);

    if (!hasValidModeResponse(response)) {
        throw new Error('Website helper unavailable');
    }

    return response;
}

function getModeLabel(selectedMode) {
    if (selectedMode === 'slight') {
        return 'Slightly wider';
    }

    return 'Full screen';
}

function getStatusMessage(pageState) {
    if (pageState.storageError) {
        return 'Could not read your saved setting.';
    }

    if (pageState.mode === 'off') {
        return 'Normal layout';
    }

    const modeLabel = getModeLabel(pageState.mode);

    if (pageState.applied) {
        return `${modeLabel} applied`;
    }

    return `${modeLabel} saved. No extra width is available here.`;
}

function getHelpMessage(selectedMode) {
    if (selectedMode === 'full') {
        return 'Extends behind Safari’s controls. Some content may be covered.';
    }

    if (selectedMode === 'slight') {
        return 'Uses half the extra side space.';
    }

    return 'Normal page width. Use default follows your all-websites setting.';
}

function renderPageState(pageState) {
    // Display the applied result, not just the requested or saved preference.
    modeSelect.value = pageState.siteMode;
    statusText.textContent = getStatusMessage(pageState);
    helpText.textContent = getHelpMessage(pageState.mode);
}

function setWidthControlsDisabled(isDisabled) {
    modeSelect.disabled = isDisabled || !Number.isInteger(activeTabId);
    defaultModeSelect.disabled = isDisabled;
    allowAllButton.disabled = isDisabled;
    allowAccessButton.disabled = isDisabled;
}

async function synchronizeWebsiteRegistration() {
    const wasSynchronized = await browser.runtime.sendMessage({
        type: 'duoextend-sync'
    });

    if (wasSynchronized !== true) {
        throw new Error('Registration unavailable');
    }
}

async function updateSelectedMode(action) {
    if (isUpdating) {
        return;
    }

    const selectedMode = modeSelect.value;
    const effectiveMode = selectedMode === 'inherit' ? defaultMode : selectedMode;
    const needsWebsitePermission = action === 'set'
        && effectiveMode !== 'off'
        && !hasWebsiteAccess;

    if (needsWebsitePermission) {
        allowAccessButton.hidden = false;
        statusText.textContent = 'Allow website access to apply this width.';
        return;
    }

    allowAccessButton.hidden = true;
    isUpdating = true;
    setWidthControlsDisabled(true);
    statusText.textContent = 'Applying…';

    try {
        const pageState = await requestPageState(action, selectedMode);
        renderPageState(pageState);

        try {
            await synchronizeWebsiteRegistration();
        } catch {
            // The current page may be updated even if automatic reload setup fails.
            statusText.textContent += ' Reload persistence could not be updated; try again.';
        }
    } catch {
        // Read back actual state so an unsuccessful request does not leave a false selection.
        try {
            const pageState = await requestPageState('get');
            renderPageState(pageState);
        } catch {
            modeSelect.value = 'off';
        }

        statusText.textContent = 'Could not save or apply the change. Reload the page and try again.';
    } finally {
        isUpdating = false;
        setWidthControlsDisabled(false);
    }
}

async function allowWebsiteAccess() {
    if (isUpdating) {
        return;
    }

    isUpdating = true;
    setWidthControlsDisabled(true);

    try {
        // Native select changes may lose Safari's permission gesture. An explicit button
        // preserves that gesture; request only this hostname before awaiting anything else.
        const wasAllowed = await browser.permissions.request({
            origins: websitePermissionPatterns
        });

        if (wasAllowed) {
            hasWebsiteAccess = true;
            allowAccessButton.hidden = true;

            // The normal update path takes the same busy flag while applying the selection.
            isUpdating = false;
            await updateSelectedMode('set');
        } else {
            const pageState = await requestPageState('get');
            renderPageState(pageState);
            statusText.textContent = 'Website access was not allowed. Page width is unchanged.';
        }
    } catch {
        statusText.textContent = 'Could not allow website access. Please try again.';
    } finally {
        isUpdating = false;
        setWidthControlsDisabled(false);
    }
}

function renderDefaultStatus() {
    defaultModeSelect.value = defaultMode;
    allowAllButton.hidden = hasAllWebsiteAccess || defaultMode === 'off';
    if (defaultMode === 'off') {
        defaultStatusText.textContent = 'Off by default. Website choices still apply.';
    } else if (hasAllWebsiteAccess) {
        defaultStatusText.textContent = 'Applies to websites set to Use default.';
    } else {
        defaultStatusText.textContent = 'Saved default needs Safari’s all-websites access.';
    }
}

async function saveDefaultMode() {
    const requestedMode = defaultModeSelect.value;
    await browser.storage.local.set({ [DEFAULT_SETTING_KEY]: requestedMode });
    defaultMode = requestedMode;
    renderDefaultStatus();
    await synchronizeWebsiteRegistration();
    if (Number.isInteger(activeTabId)) {
        // Newly granted pages may need their first helper injection; existing tabs
        // already follow the storage event without overwriting website choices.
        try {
            renderPageState(await requestPageState('get'));
        } catch {
            statusText.textContent = 'Reload this page to apply your default.';
        }
    }
}

async function updateDefaultMode(requestAccess = false) {
    if (isUpdating || !VALID_MODES.includes(defaultModeSelect.value)) {
        return;
    }
    if (defaultModeSelect.value !== 'off' && !hasAllWebsiteAccess && !requestAccess) {
        allowAllButton.hidden = false;
        defaultStatusText.textContent = 'Allow all websites to save this default.';
        return;
    }

    isUpdating = true;
    setWidthControlsDisabled(true);
    try {
        if (requestAccess) {
            // Keep this request as the first await in the button handler so Safari
            // recognizes the user gesture. Denial must leave storage untouched.
            const wasAllowed = await browser.permissions.request({ origins: ALL_WEBSITE_PATTERNS });
            if (!wasAllowed) {
                renderDefaultStatus();
                defaultStatusText.textContent = 'All-websites access was not allowed. Default unchanged.';
                return;
            }
            hasAllWebsiteAccess = true;
            hasWebsiteAccess = true;
        }
        await saveDefaultMode();
    } catch {
        // Read back the persisted value even if registration failed after the write.
        try {
            const saved = await browser.storage.local.get(DEFAULT_SETTING_KEY);
            defaultMode = normalizeSavedMode(saved[DEFAULT_SETTING_KEY]);
        } catch {
            // Keep the last known default when storage itself is unavailable.
        }
        renderDefaultStatus();
        defaultStatusText.textContent = 'Could not finish updating the default. Try again or reload.';
    } finally {
        isUpdating = false;
        setWidthControlsDisabled(false);
    }
}

async function initializePopup() {
    try {
        const saved = await browser.storage.local.get(DEFAULT_SETTING_KEY);
        defaultMode = normalizeSavedMode(saved[DEFAULT_SETTING_KEY]);
        hasAllWebsiteAccess = await browser.permissions.contains({ origins: ALL_WEBSITE_PATTERNS });
        renderDefaultStatus();
        defaultModeSelect.disabled = false;
    } catch {
        defaultStatusText.textContent = 'Could not read the default. Reopen DuoEXTEND to retry.';
    }

    try {
        const [activeTab] = await browser.tabs.query({
            active: true,
            currentWindow: true
        });
        const pageUrl = new URL(activeTab?.url);
        const isWebsite = ['http:', 'https:'].includes(pageUrl.protocol);

        if (!isWebsite || !Number.isInteger(activeTab.id)) {
            throw new Error('unsupported');
        }

        activeTabId = activeTab.id;
        websitePermissionPatterns = ['http', 'https'].map(scheme => {
            return `${scheme}://${pageUrl.hostname}/*`;
        });
        websiteName.textContent = pageUrl.hostname;
        hasWebsiteAccess = await browser.permissions.contains({
            origins: websitePermissionPatterns
        });

        const websiteSettingKey = `wide:${pageUrl.hostname.toLowerCase()}`;
        const savedSettings = await browser.storage.local.get(websiteSettingKey);
        modeSelect.value = savedSettings[websiteSettingKey] === undefined
            ? 'inherit' : normalizeSavedMode(savedSettings[websiteSettingKey]);
        setWidthControlsDisabled(false);

        try {
            const pageState = await requestPageState('get');
            renderPageState(pageState);
        } catch {
            statusText.textContent = 'Choose a width to allow website access, or reload after updating DuoEXTEND.';
        }

        allowAccessButton.hidden = hasWebsiteAccess || modeSelect.value === 'off'
            || (modeSelect.value === 'inherit' && defaultMode === 'off');
    } catch {
        statusText.textContent = 'Open a website in Safari to choose its width.';
    }
}

modeSelect.addEventListener('change', () => updateSelectedMode('set'));
allowAccessButton.addEventListener('click', allowWebsiteAccess);

defaultModeSelect.addEventListener('change', () => updateDefaultMode());
allowAllButton.addEventListener('click', () => updateDefaultMode(true));

await initializePopup();
