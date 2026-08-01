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

function isSupportedTab(tab) {
    if (!tab || !tab.id || !tab.url) {
        return false;
    }

    try {
        const parsedUrl = new URL(tab.url);
        if (parsedUrl.protocol !== 'https:') return false;

        const domain = getRegistrableDomain(parsedUrl.hostname);
        if (STREAM_DOMAINS.has(domain)) return true;

        if (AMAZON_DOMAINS.has(domain)) {
            return /\/gp\/video\b|\/detail\//i.test(parsedUrl.pathname);
        }

        return false;
    } catch (error) {
        return false;
    }
}

chrome.action.onClicked.addListener(async (tab) => {
    if (!isSupportedTab(tab)) {
        return;
    }

    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => !!document.documentElement.dataset.hsSpeedBootedV2
        });

        if (result && result.result) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => window.dispatchEvent(new CustomEvent('hs-speed-toggle-v2'))
            });
        } else {
            await chrome.scripting.insertCSS({
                target: { tabId: tab.id },
                files: ['styles.css']
            });

            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            });
        }
    } catch (_error) {
        // Fail closed: do not log tab URLs, titles, or error payloads (can contain PII).
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === 'openOptionsPage') {
        chrome.runtime.openOptionsPage();
    }
});
