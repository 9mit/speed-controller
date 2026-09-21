/**
 * OTT SPEED PLAYBACK - Background Service Worker (v2.3.0)
 * Manages tab commands, options navigation, and cross-context coordination.
 */

const STREAM_DOMAINS = new Set([
    'hotstar.com',
    'jiohotstar.com',
    'netflix.com',
    'primevideo.com',
    'zee5.com',
    'airtelxstream.in',
    'xstreamplay.in',
    'jiocinema.com',
    'sonyliv.com',
    'aha.video',
    'hoichoi.tv',
    'sunnxt.com',
    'mxplayer.in'
]);

const AMAZON_DOMAINS = new Set([
    'amazon.com',
    'amazon.in',
    'amazon.co.uk',
    'amazon.de',
    'amazon.ca',
    'amazon.com.au',
    'amazon.co.jp',
    'amazon.fr',
    'amazon.it',
    'amazon.es',
    'amazon.com.br',
    'amazon.com.mx'
]);

function getRegistrableDomain(hostname) {
    if (!hostname) return '';
    const parts = hostname.toLowerCase().split('.').filter(Boolean);
    if (parts.length < 2) return hostname.toLowerCase();

    // Handle common multi-part TLDs (co.uk, com.au, co.jp, com.br, com.mx)
    const multiPartTlds = new Set(['co.uk', 'com.au', 'co.jp', 'com.br', 'com.mx']);
    const lastTwo = parts.slice(-2).join('.');
    if (parts.length >= 3 && multiPartTlds.has(lastTwo)) {
        return parts.slice(-3).join('.');
    }
    return lastTwo;
}

function isSupportedUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
        const parsedUrl = new URL(rawUrl);
        if (parsedUrl.protocol !== 'https:') return false;

        const domain = getRegistrableDomain(parsedUrl.hostname);
        if (STREAM_DOMAINS.has(domain)) return true;

        if (AMAZON_DOMAINS.has(domain)) {
            return /\/gp\/video\b|\/detail\/|\/Prime-Video\b/i.test(parsedUrl.pathname);
        }

        return false;
    } catch (_) {
        return false;
    }
}

function isSupportedTab(tab) {
    return !!(tab && tab.id && tab.url && isSupportedUrl(tab.url));
}

async function ensureContentScripts(tabId) {
    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => !!document.documentElement.dataset.hsSpeedBootedV2
        });

        if (!result || !result.result) {
            await chrome.scripting.insertCSS({
                target: { tabId },
                files: ['styles.css']
            }).catch(() => {});

            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            }).catch(() => {});
        }
        return true;
    } catch (_) {
        return false;
    }
}

async function toggleOverlay(tabId) {
    if (!tabId) return;
    const ready = await ensureContentScripts(tabId);
    if (!ready) return;

    try {
        await chrome.tabs.sendMessage(tabId, { action: 'toggleOverlay' });
    } catch (_) {
        // Fallback to DOM custom event dispatch
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                func: () => window.dispatchEvent(new CustomEvent('hs-speed-toggle-v2'))
            });
        } catch (_) {}
    }
}

// Global keyboard command listener (Alt+Shift+S)
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-overlay') {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && isSupportedTab(tab)) {
                await toggleOverlay(tab.id);
            }
        } catch (_) {}
    }
});

// Runtime message passing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return;

    if (message.action === 'openOptionsPage') {
        chrome.runtime.openOptionsPage();
        sendResponse({ success: true });
        return;
    }

    if (message.action === 'checkActiveTab') {
        chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
            if (!tab || !tab.id) {
                sendResponse({ supported: false });
                return;
            }
            const supported = isSupportedTab(tab);
            sendResponse({
                supported,
                tabId: tab.id,
                url: supported ? tab.url : undefined
            });
        }).catch(() => {
            sendResponse({ supported: false });
        });
        return true; // Keep channel open for async response
    }

    if (message.action === 'toggleOverlayOnTab') {
        const tabId = message.tabId;
        if (tabId) {
            toggleOverlay(tabId).then(() => sendResponse({ success: true }));
            return true;
        }
    }
});
