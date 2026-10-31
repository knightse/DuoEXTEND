// Register page helpers only where a saved active setting and Safari permission agree.
// Preferences remain in extension-local storage; this context may be suspended by Safari.
const WEBSITE_SETTING_PREFIX = 'wide:';
const SCRIPT_ID_PREFIX = 'duo-';
const DEFAULT_SETTING_KEY = 'default:width';
const ALL_WEBSITE_PATTERNS = ['http://*/*', 'https://*/*'];

const DEFAULT_SCRIPT_ID = 'duo-default:all';

function isActiveSavedMode(savedValue) {
    // Legacy boolean true is still active; the page interprets it as Slightly wider.
    return [true, 'slight', 'full'].includes(savedValue);
}

function createWebsiteScript(hostname, websitePatterns) {
    return {
        id: `${SCRIPT_ID_PREFIX}${encodeURIComponent(hostname)}`,
        matches: websitePatterns,
        js: ['layout.js', 'content.js'],
        runAt: 'document_end',
        allFrames: false,
        persistAcrossSessions: true
    };
}

async function getAllowedWebsiteScripts(api) {
    const savedSettings = await api.storage.local.get(null);
    const allowedScripts = [];

    if (isActiveSavedMode(savedSettings[DEFAULT_SETTING_KEY])) {
        const hasAllWebsiteAccess = await api.permissions.contains({ origins: ALL_WEBSITE_PATTERNS });
        if (hasAllWebsiteAccess) {
            // One helper covers all sites; each page still resolves its own Off/width override.
            const defaultScript = createWebsiteScript('default', ALL_WEBSITE_PATTERNS);
            defaultScript.id = DEFAULT_SCRIPT_ID;
            return [defaultScript];
        }
    }


    for (const [settingKey, savedMode] of Object.entries(savedSettings)) {
        if (!settingKey.startsWith(WEBSITE_SETTING_PREFIX) || !isActiveSavedMode(savedMode)) {
            continue;
        }

        const hostname = settingKey.slice(WEBSITE_SETTING_PREFIX.length);

        if (!hostname || /[/*\s]/.test(hostname)) {
            continue;
        }

        // Keep subdomains separate. Never turn a stored hostname into an all-sites pattern.
        const websitePatterns = ['http', 'https'].map(scheme => `${scheme}://${hostname}/*`);
        const hasWebsiteAccess = await api.permissions.contains({ origins: websitePatterns });

        if (hasWebsiteAccess) {
            allowedScripts.push(createWebsiteScript(hostname, websitePatterns));
        }
    }

    return allowedScripts;
}

export async function syncSites(api = browser) {
    const wantedScripts = await getAllowedWebsiteScripts(api);
    const registeredScripts = await api.scripting.getRegisteredContentScripts();

    // Remove only our own obsolete registrations; leave unrelated registrations untouched.
    const obsoleteScripts = registeredScripts.filter(registeredScript => {
        const belongsToDuoExtend = registeredScript.id.startsWith(SCRIPT_ID_PREFIX);
        const isStillWanted = wantedScripts.some(script => script.id === registeredScript.id);
        return belongsToDuoExtend && !isStillWanted;
    });

    if (obsoleteScripts.length > 0) {
        const obsoleteIds = obsoleteScripts.map(script => script.id);
        await api.scripting.unregisterContentScripts({ ids: obsoleteIds });
    }

    const missingScripts = wantedScripts.filter(wantedScript => {
        return !registeredScripts.some(script => script.id === wantedScript.id);
    });

    if (missingScripts.length > 0) {
        await api.scripting.registerContentScripts(missingScripts);
    }
}

// The exported function also runs in our Node tests, where browser is not present.
if (typeof browser !== 'undefined') {
    let pendingSynchronization = Promise.resolve();

    function queueSiteSynchronization() {
        // Serialize updates so a storage event and a popup request cannot register twice.
        pendingSynchronization = pendingSynchronization
            .catch(() => {
                // A previous failure must not prevent the next request from retrying.
            })
            .then(() => syncSites());

        return pendingSynchronization;
    }

    function synchronizeInBackground() {
        queueSiteSynchronization().catch(() => {
            console.warn('DuoEXTEND could not update website access.');
        });
    }

    function handleSynchronizationMessage(message) {
        if (message?.type === 'duoextend-sync') {
            // The popup waits for this acknowledgment before reporting reload persistence.
            return queueSiteSynchronization().then(() => true);
        }
    }

    browser.runtime.onInstalled.addListener(synchronizeInBackground);
    browser.runtime.onStartup.addListener(synchronizeInBackground);
    browser.storage.onChanged.addListener(synchronizeInBackground);
    browser.permissions.onAdded.addListener(synchronizeInBackground);
    browser.permissions.onRemoved.addListener(synchronizeInBackground);
    browser.runtime.onMessage.addListener(handleSynchronizationMessage);
}
