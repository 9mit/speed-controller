/**
 * OTT SPEED PLAYBACK - Background Service Worker (v4.1.0)
 * Manages tab commands, options navigation, and cross-context coordination.
 * Hardened with Zero-Trust message validation and strict sender verification.
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
    if (!hostname || typeof hostname !== 'string') return '';
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
    return !!(tab && typeof tab.id === 'number' && tab.url && isSupportedUrl(tab.url));
}

async function ensureContentScripts(tabId) {
    if (typeof tabId !== 'number') return false;
    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => !!(document.documentElement.dataset.hsSpeedBootedV4 || document.documentElement.dataset.hsSpeedBootedV2)
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
    if (typeof tabId !== 'number') return;
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!isSupportedTab(tab)) return;

        const ready = await ensureContentScripts(tabId);
        if (!ready) return;

        await chrome.tabs.sendMessage(tabId, { action: 'toggleOverlay' });
    } catch (_) {}
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

// Runtime message passing with strict sender verification
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Zero-Trust: Reject any message from external extensions or untrusted senders
    if (!sender || sender.id !== chrome.runtime.id) return;
    if (!message || typeof message !== 'object') return;

    if (message.action === 'openOptionsPage') {
        chrome.runtime.openOptionsPage();
        sendResponse({ success: true });
        return;
    }
});
