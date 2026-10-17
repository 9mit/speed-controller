/**
 * OTT SPEED PLAYBACK (v5.2)
 * Playback rate control for YouTube, YouTube Shorts, Hotstar, JioHotstar, Netflix, Prime Video,
 * ZEE5, Airtel Xstream, JioCinema, SonyLIV, Aha, Hoichoi, Sun NXT, and MX Player.
 * Built with Smart Live Stream Detection & Auto Normal Speed Guard, Smart Pace finish-time mode,
 * and adaptive speed targeting.
 */
(function () {
    'use strict';

    const ROOT_FLAG = 'hsSpeedBootedV2';
    const TOGGLE_EVENT = 'hs-speed-toggle-v2';
    const DEFAULT_SPEEDS = [1, 1.25, 1.5, 1.75, 2, 2.5];
    const REFRESH_MS = 1000;
    const MAX_SPEED = 16;

    if (document.documentElement.dataset[ROOT_FLAG] === 'true') {
        window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
        return;
    }
    document.documentElement.dataset[ROOT_FLAG] = 'true';

    // --- Shared video discovery (incl. open shadow roots) ---
    function collectVideos(root, results) {
        if (!root) return results;
        try {
            root.querySelectorAll('video').forEach((v) => results.push(v));
            root.querySelectorAll('*').forEach((el) => {
                if (el.shadowRoot) collectVideos(el.shadowRoot, results);
            });
        } catch (_) { /* cross-origin or closed shadow roots */ }
        return results;
    }

    function isVideoInViewport(v) {
        try {
            const rect = v.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight;
            const vw = window.innerWidth || document.documentElement.clientWidth;
            return rect.width > 0 && rect.height > 0 &&
                   rect.top < vh && rect.bottom > 0 &&
                   rect.left < vw && rect.right > 0;
        } catch (_) {
            return false;
        }
    }

    function pickLargestVideo(videos) {
        const connected = videos.filter((v) => v.isConnected);
        if (!connected.length) return videos[0] || null;

        // 1. If any video is actively playing, prioritize it (essential for YouTube Shorts & carousels)
        const playing = connected.filter((v) => !v.paused && v.readyState >= 1);
        if (playing.length === 1) return playing[0];
        if (playing.length > 1) {
            return playing.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
        }

        // 2. Filter to videos visible within the viewport (ignores offscreen preloaded shorts)
        const inViewport = connected.filter((v) => isVideoInViewport(v));
        const pool = inViewport.length ? inViewport : connected;

        const ready = pool.filter((v) => v.readyState >= 1);
        const candidates = ready.length ? ready : pool;
        return candidates.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
    }

    function cleanTitle(raw, suffixes) {
        // Strip control chars / HTML-ish markup; titles are display-only (never persisted).
        let title = String(raw || '')
            .replace(/[\u0000-\u001F\u007F]/g, '')
            .replace(/[<>&"`']/g, '')
            .trim()
            .slice(0, 120);
        for (const suffix of suffixes) {
            title = title.replace(suffix, '').trim();
        }
        return title || 'Current Video';
    }

    function sanitizeSpeed(value, fallback = 1.0) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return fallback;
        return Math.min(MAX_SPEED, Math.max(0.25, Math.round(n * 100) / 100));
    }

    // --- Platform adapters (Protected v2.3 implementation) ---
    const Platforms = {
        hotstar: {
            id: 'hotstar',
            label: 'Hotstar',
            match(hostname) {
                return /(^|\.)hotstar\.com$|(^|\.)jiohotstar\.com$/i.test(hostname);
            },
            getContentId(pathname) {
                const match = pathname.match(/\/([0-9]{8,15})\/watch/);
                return match ? match[1] : 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*-\s*(JioHotstar|Disney\+ Hotstar|Hotstar).*$/i
                ]);
            }
        },

        netflix: {
            id: 'netflix',
            label: 'Netflix',
            match(hostname) {
                return /(^|\.)netflix\.com$/i.test(hostname);
            },
            getContentId(pathname) {
                const watch = pathname.match(/\/watch\/(\d+)/);
                if (watch) return watch[1];
                const title = pathname.match(/\/title\/(\d+)/);
                if (title) return title[1];
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*\|\s*Netflix\s*$/i,
                    /\s*-\s*Netflix\s*$/i
                ]);
            }
        },

        prime: {
            id: 'prime',
            label: 'Prime Video',
            match(hostname, pathname) {
                if (/(^|\.)primevideo\.com$/i.test(hostname)) return true;
                if (/(^|\.)amazon\./i.test(hostname)) {
                    return /\/gp\/video\b|\/detail\//i.test(pathname || '');
                }
                return false;
            },
            getContentId(pathname) {
                const detail = pathname.match(/\/(?:gp\/video\/)?detail\/([A-Z0-9]+)/i);
                if (detail) return detail[1];
                const watch = pathname.match(/\/(?:region\/[^/]+\/)?video\/detail\/([A-Z0-9]+)/i);
                if (watch) return watch[1];
                const asins = pathname.match(/\/([A-Z0-9]{10})(?:\/|$|\?)/);
                if (asins) return asins[1];
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*:\s*Prime Video\s*$/i,
                    /\s*-\s*Prime Video\s*$/i,
                    /\s*\|\s*Prime Video\s*$/i,
                    /\s*:\s*Amazon\.co.*$/i,
                    /\s*-\s*Amazon\.co.*$/i,
                    /\s*:\s*Amazon\.com.*$/i,
                    /\s*-\s*Amazon\.com.*$/i
                ]);
            }
        },

        zee5: {
            id: 'zee5',
            label: 'ZEE5',
            match(hostname) {
                return /(^|\.)zee5\.com$/i.test(hostname);
            },
            getContentId(pathname) {
                const match = pathname.match(/\/([a-z0-9]+-[a-z0-9]+-[a-z0-9]+)(?:\/|$|\?)/i);
                if (match) return match[1];

                const parts = pathname.split('/').filter(Boolean);
                if (parts.length > 0) {
                    const last = parts[parts.length - 1];
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) {
                        return last;
                    }
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*-\s*ZEE5\s*$/i,
                    /\s*\|\s*ZEE5\s*$/i,
                    /\s*Watch\s*.*on\s*ZEE5$/i
                ]);
            }
        },

        airtelxstream: {
            id: 'airtelxstream',
            label: 'Airtel Xstream',
            match(hostname) {
                return /(^|\.)airtelxstream\.in$/i.test(hostname) || /(^|\.)xstreamplay\.in$/i.test(hostname);
            },
            getContentId(pathname) {
                const detail = pathname.match(/\/detail-page\/([a-z0-9_-]+)/i);
                if (detail) return detail[1];

                const parts = pathname.split('/').filter(Boolean);
                if (parts.length > 0) {
                    const last = parts[parts.length - 1];
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) {
                        return last;
                    }
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*-\s*Airtel Xstream.*$/i,
                    /\s*\|\s*Airtel Xstream.*$/i,
                    /\s*-\s*Airtel Xstream Play.*$/i,
                    /\s*\|\s*Airtel Xstream Play.*$/i
                ]);
            }
        },

        jiocinema: {
            id: 'jiocinema',
            label: 'JioCinema',
            match(hostname) {
                return /(^|\.)jiocinema\.com$/i.test(hostname);
            },
            getContentId(pathname) {
                const parts = pathname.split('/').filter(Boolean);
                if (parts.length > 0) {
                    const last = parts[parts.length - 1];
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) {
                        return last;
                    }
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*-\s*JioCinema\s*$/i,
                    /\s*\|\s*JioCinema\s*$/i,
                    /\s*Watch\s*.*on\s*JioCinema$/i
                ]);
            }
        },

        sonyliv: {
            id: 'sonyliv',
            label: 'SonyLIV',
            match(hostname) {
                return /(^|\.)sonyliv\.com$/i.test(hostname);
            },
            getContentId(pathname) {
                const match = pathname.match(/-(\d{6,15})(?:\/|$|\?)/i) || pathname.match(/\/(\d{6,15})(?:\/|$|\?)/i);
                if (match) return match[1];

                const parts = pathname.split('/').filter(Boolean);
                if (parts.length > 0) {
                    const last = parts[parts.length - 1];
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) {
                        return last;
                    }
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*-\s*SonyLIV\s*$/i,
                    /\s*\|\s*SonyLIV\s*$/i,
                    /\s*Watch\s*.*on\s*SonyLIV$/i
                ]);
            }
        },

        aha: {
            id: 'aha',
            label: 'Aha',
            match(hostname) {
                return /(^|\.)aha\.video$/i.test(hostname);
            },
            getContentId(pathname) {
                const parts = pathname.split('/').filter(Boolean);
                if (parts.length > 0) {
                    const last = parts[parts.length - 1];
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) {
                        return last;
                    }
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*-\s*aha\s*$/i,
                    /\s*\|\s*aha\s*$/i,
                    /\s*Watch\s*.*on\s*aha$/i
                ]);
            }
        },

        hoichoi: {
            id: 'hoichoi',
            label: 'Hoichoi',
            match(hostname) {
                return /(^|\.)hoichoi\.tv$/i.test(hostname);
            },
            getContentId(pathname) {
                const parts = pathname.split('/').filter(Boolean);
                if (parts.length > 0) {
                    const last = parts[parts.length - 1];
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) {
                        return last;
                    }
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*-\s*hoichoi\s*$/i,
                    /\s*\|\s*hoichoi\s*$/i,
                    /\s*Watch\s*.*on\s*hoichoi$/i
                ]);
            }
        },

        sunnxt: {
            id: 'sunnxt',
            label: 'Sun NXT',
            match(hostname) {
                return /(^|\.)sunnxt\.com$/i.test(hostname);
            },
            getContentId(pathname) {
                const parts = pathname.split('/').filter(Boolean);
                if (parts.length > 0) {
                    const last = parts[parts.length - 1];
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) {
                        return last;
                    }
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*-\s*Sun NXT\s*$/i,
                    /\s*\|\s*Sun NXT\s*$/i,
                    /\s*Watch\s*.*on\s*Sun NXT$/i
                ]);
            }
        },

        mxplayer: {
            id: 'mxplayer',
            label: 'MX Player',
            match(hostname) {
                return /(^|\.)mxplayer\.in$/i.test(hostname);
            },
            getContentId(pathname) {
                const parts = pathname.split('/').filter(Boolean);
                if (parts.length > 0) {
                    const last = parts[parts.length - 1];
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) {
                        return last;
                    }
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*-\s*MX Player\s*$/i,
                    /\s*\|\s*MX Player\s*$/i,
                    /\s*Watch\s*.*on\s*MX Player$/i
                ]);
            }
        },

        youtube: {
            id: 'youtube',
            label: 'YouTube',
            match(hostname) {
                return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(hostname);
            },
            getContentId(pathname) {
                // 1. YouTube Shorts: /shorts/:id
                const shortsMatch = pathname.match(/\/shorts\/([a-zA-Z0-9_-]{6,16})/i);
                if (shortsMatch) {
                    return `yt_short_${shortsMatch[1]}`;
                }

                // 2. Standard Watch URL: /watch?v=:id
                try {
                    const searchParams = new URLSearchParams(window.location.search);
                    const v = searchParams.get('v');
                    if (v && /^[a-zA-Z0-9_-]{6,16}$/.test(v)) {
                        return `yt_${v}`;
                    }
                } catch (_) {}

                // 3. youtu.be/:id
                if (/(^|\.)youtu\.be$/i.test(window.location.hostname)) {
                    const shortMatch = pathname.match(/^\/([a-zA-Z0-9_-]{6,16})/);
                    if (shortMatch) {
                        return `yt_${shortMatch[1]}`;
                    }
                }

                // 4. Embed: /embed/:id
                const embedMatch = pathname.match(/\/embed\/([a-zA-Z0-9_-]{6,16})/i);
                if (embedMatch) {
                    return `yt_${embedMatch[1]}`;
                }

                // 5. Live stream: /live/:id
                const liveMatch = pathname.match(/\/live\/([a-zA-Z0-9_-]{6,16})/i);
                if (liveMatch) {
                    return `yt_live_${liveMatch[1]}`;
                }

                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [
                    /\s*-\s*YouTube\s*$/i
                ]);
            }
        }
    };

    function detectPlatform() {
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;
        for (const platform of Object.values(Platforms)) {
            if (platform.match(hostname, pathname)) return platform;
        }
        return null;
    }

    const Platform = detectPlatform();
    if (!Platform) {
        return;
    }

    // --- HSE_Store: Persistence & Settings (local-only; no sync / no network) ---
    const HSE_Store = {
        settings: {
            defaultSpeed: 1.0,
            globalSpeed: 1.0,
            showSpeeds: {},
            paceProfile: {
                averageSpeed: 1.0,
                sampleCount: 0
            }
        },
        customSettings: {
            keySpeedUp: ']',
            keySpeedDown: '[',
            keyReset: 'r',
            keySkipForward: 'ArrowRight',
            keySkipBack: 'ArrowLeft',
            keySmartSpeed: 'Shift',
            smartSpeedValue: 2.0
        },

        /**
         * Accept only known fields. Never persist titles, URLs, cookies, or PII.
         * showSpeeds values are numeric playback rates keyed by platform:contentId.
         */
        hydrateFromStorage(raw, customRaw) {
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                if (typeof raw.defaultSpeed === 'number') {
                    const def = sanitizeSpeed(raw.defaultSpeed, 1.0);
                    this.settings.defaultSpeed = (def < 0.25) ? 1.0 : def;
                }

                if (typeof raw.globalSpeed === 'number') {
                    const fallback = this.settings.defaultSpeed || 1.0;
                    const speed = sanitizeSpeed(raw.globalSpeed, fallback);
                    this.settings.globalSpeed = (speed < 0.25) ? fallback : speed;
                }

                const speeds = raw.showSpeeds;
                if (speeds && typeof speeds === 'object' && !Array.isArray(speeds)) {
                    const cleaned = {};
                    for (const [key, value] of Object.entries(speeds)) {
                        if (typeof key !== 'string' || key.length > 64) continue;
                        if (!/^[a-z0-9:_-]+$/i.test(key)) continue;
                        if (typeof value !== 'number') continue;
                        const s = sanitizeSpeed(value, 1.0);
                        if (s >= 0.25) {
                            cleaned[key] = s;
                        }
                    }
                    this.settings.showSpeeds = cleaned;
                }

                if (raw.paceProfile && typeof raw.paceProfile === 'object') {
                    const avg = Number(raw.paceProfile.averageSpeed);
                    const cnt = Number(raw.paceProfile.sampleCount);
                    if (Number.isFinite(avg) && avg >= 0.25 && avg <= MAX_SPEED) {
                        this.settings.paceProfile.averageSpeed = avg;
                    }
                    if (Number.isFinite(cnt) && cnt >= 0) {
                        this.settings.paceProfile.sampleCount = cnt;
                    }
                }
            }

            if (customRaw && typeof customRaw === 'object') {
                this.customSettings = { ...this.customSettings, ...customRaw };
                this.customSettings.smartSpeedValue = parseFloat(this.customSettings.smartSpeedValue) || 2.0;
            }
        },

        async init() {
            try {
                if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime?.id) {
                    return;
                }
                const result = await chrome.storage.local.get(['hse_settings', 'hse_custom_settings']);
                this.hydrateFromStorage(result.hse_settings, result.hse_custom_settings);
            } catch (err) {
                console.warn('OTT SPEED PLAYBACK: Extension context invalidated during init.', err);
            }
        },

        async save() {
            try {
                if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime?.id) {
                    return;
                }
                const currentData = await chrome.storage.local.get(['hse_settings']).catch(() => ({}));
                const existing = (currentData && currentData.hse_settings && typeof currentData.hse_settings === 'object') ? currentData.hse_settings : {};
                const payload = {
                    hse_settings: {
                        ...existing,
                        defaultSpeed: this.settings.defaultSpeed,
                        globalSpeed: this.settings.globalSpeed,
                        showSpeeds: this.settings.showSpeeds,
                        paceProfile: this.settings.paceProfile
                    }
                };
                await chrome.storage.local.set(payload);
            } catch (err) {
                console.warn('OTT SPEED PLAYBACK: Extension context invalidated during save.', err);
            }
        },

        storageKey(showId) {
            return `${Platform.id}:${showId}`;
        },

        getSpeedForShow(showId) {
            const fallback = this.settings.defaultSpeed || 1.0;
            const key = this.storageKey(showId);
            // Check specific title speed if available and valid
            if (showId && showId !== 'generic' && this.settings.showSpeeds[key] != null) {
                const s = sanitizeSpeed(this.settings.showSpeeds[key], fallback);
                if (s >= 0.25) return s;
            }
            if (Platform.id === 'hotstar' && showId && showId !== 'generic' && this.settings.showSpeeds[showId] != null) {
                const s = sanitizeSpeed(this.settings.showSpeeds[showId], fallback);
                if (s >= 0.25) return s;
            }
            // Fall back to active user global speed (e.g. 2.0x set on first episode)
            const global = sanitizeSpeed(this.settings.globalSpeed, fallback);
            return (global >= 0.25) ? global : fallback;
        },

        setSpeedForShow(showId, speed) {
            const clamped = sanitizeSpeed(speed, 1.0);
            this.settings.globalSpeed = clamped;
            if (showId && showId !== 'generic') {
                this.settings.showSpeeds[this.storageKey(showId)] = clamped;
            }
            this.save();
        },

        recordUserSpeed(speed) {
            const s = sanitizeSpeed(speed);
            const current = this.settings.paceProfile;
            const count = current.sampleCount || 0;
            const newCount = Math.min(count + 1, 100);
            current.averageSpeed = Math.round(((current.averageSpeed * count + s) / newCount) * 100) / 100;
            current.sampleCount = newCount;
            this.save();
        },

        getPersonalPace() {
            return (this.settings.paceProfile && this.settings.paceProfile.averageSpeed) || 1.0;
        }
    };

    // --- HSE_Intel: DOM & Pattern Analysis ---
    const HSE_Intel = {
        getContentInfo() {
            const path = window.location.pathname;
            let id = 'generic';
            try {
                id = String(Platform.getContentId(path) || 'generic').slice(0, 32);
                if (!/^[a-z0-9_-]+$/i.test(id)) id = 'generic';
            } catch (_) {}
            let title = 'Current Video';
            try {
                title = Platform.getTitle();
            } catch (_) {}
            return { id, title, platform: Platform.id };
        },

        getVideo() {
            return pickLargestVideo(collectVideos(document, []));
        },

        isLive(video) {
            const v = video || this.getVideo();
            if (!v) return false;
            try {
                // 1. Explicit HTML5 standard: infinite duration on ongoing live media streams
                if (v.duration === Infinity) return true;

                // 2. Ready state >= 1 with non-finite duration
                if (!Number.isFinite(v.duration) && v.readyState >= 1) return true;

                // 3. Platform specific detection
                if (Platform.id === 'youtube') {
                    const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
                    if (ytPlayer) {
                        if (typeof ytPlayer.getVideoData === 'function') {
                            const data = ytPlayer.getVideoData();
                            if (data && (data.isLive === true || data.isLiveStream === true)) return true;
                        }
                        if (typeof ytPlayer.isLive === 'function' && ytPlayer.isLive()) return true;
                        if (ytPlayer.classList && ytPlayer.classList.contains('ytp-live')) return true;
                    }
                    if (document.querySelector('.ytp-live-badge, ytd-watch-flexy[live], .badge-style-type-live-now, ytd-live-chat-frame')) {
                        return true;
                    }
                    const path = window.location.pathname || '';
                    if (/\/live(\/|$|\?)/i.test(path) || (window.location.search && window.location.search.includes('live=1'))) {
                        return true;
                    }
                }

                if (Platform.id === 'hotstar') {
                    if (document.querySelector('[data-testid="live-tag"], .live-tag, .live-badge, [data-testid="player-live-badge"]')) {
                        return true;
                    }
                    const path = window.location.pathname || '';
                    if (/\/live\b|\/sports\/.*\/live\b|\/channels\//i.test(path)) {
                        return true;
                    }
                }

                if (Platform.id === 'jiocinema') {
                    if (document.querySelector('[data-testid*="live"], .live-indicator, .live-badge, .live-tag')) {
                        return true;
                    }
                    const path = window.location.pathname || '';
                    if (/\/sports\b|\/live-tv\b/i.test(path)) {
                        return true;
                    }
                }

                if (Platform.id === 'prime') {
                    if (document.querySelector('.atvwebplayersdk-live-badge, [data-testid="live-indicator"], [aria-label*="Live" i]')) {
                        return true;
                    }
                }

                if (Platform.id === 'zee5' || Platform.id === 'sonyliv' || Platform.id === 'airtelxstream' || Platform.id === 'sunnxt' || Platform.id === 'aha' || Platform.id === 'hoichoi' || Platform.id === 'mxplayer') {
                    const path = window.location.pathname || '';
                    if (/\/live-tv\b|\/live-channels\b|\/channels\b/i.test(path)) {
                        return true;
                    }
                }

                // 4. Generic DOM check in player container
                const container = v.closest(
                    '.html5-video-player, [data-testid="player-container"], .player-container, ' +
                    '.shaka-video-container, .video-container, [data-testid="video-player"], body'
                );
                if (container) {
                    const badge = container.querySelector(
                        '.ytp-live-badge, [data-testid*="live-tag"], .live-tag, .live-badge, ' +
                        '.live-indicator, .atvwebplayersdk-live-badge, .badge-style-type-live-now'
                    );
                    if (badge) return true;
                }
            } catch (_) {}
            return false;
        }
    };

    function injectMainWorldScript() {
        if (document.documentElement.dataset.hseMainWorldInjected === 'true') return;
        document.documentElement.dataset.hseMainWorldInjected = 'true';
        try {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('main_world.js');
            script.onload = function () { this.remove(); };
            (document.head || document.documentElement).appendChild(script);
        } catch (_) {}
    }

    // --- HSE_Engine: Action & Enforcement ---
    const HSE_Engine = {
        currentSpeed: 1.0,
        lastContentId: null,
        isLiveVideo: false,
        wasLiveVideo: false,

        setSpeed(speed, isPersistent = true, isManual = false) {
            const video = HSE_Intel.getVideo();
            const isLive = this.isLiveVideo || HSE_Intel.isLive(video);

            if (isLive) {
                // Live videos cannot be sped up to prevent immediate buffer exhaustion and stall
                if (speed > 1.05) {
                    if (isManual) {
                        HSE_UI.flash('Live streams locked to 1.0x normal speed');
                    }
                    return;
                }
                this.currentSpeed = 1.0;
                document.documentElement.dataset.hsePlaybackRate = '1';
                document.documentElement.dataset.hseIsLive = 'true';
                if (video) {
                    try {
                        video.playbackRate = 1.0;
                        video.defaultPlaybackRate = 1.0;
                    } catch (_) {}
                }
                HSE_UI.update();
                if (isManual) HSE_UI.flash('1.0x Normal Speed');
                return;
            }

            const clamped = sanitizeSpeed(speed, 1.0);
            this.currentSpeed = clamped;
            document.documentElement.dataset.hsePlaybackRate = String(clamped);

            try {
                window.dispatchEvent(new CustomEvent('hs-speed-change', { detail: { speed: clamped } }));
            } catch (_) {}

            if (video) {
                try {
                    if (Math.abs(video.playbackRate - clamped) > 0.01) {
                        video.playbackRate = clamped;
                    }
                    if (Math.abs(video.defaultPlaybackRate - clamped) > 0.01) {
                        video.defaultPlaybackRate = clamped;
                    }
                    if (video.preservesPitch === false) {
                        video.preservesPitch = true;
                    }
                } catch (_) {}
            }

            if (isPersistent) {
                const info = HSE_Intel.getContentInfo();
                HSE_Store.setSpeedForShow(info.id, clamped);
                if (isManual) {
                    HSE_Store.recordUserSpeed(clamped);
                    // Manual override pauses or cancels automatic smart pace
                    if (HSE_SmartPace.isActive) {
                        HSE_SmartPace.stop(false);
                    }
                }
                HSE_UI.update();
                HSE_UI.flash(clamped + 'x');
            }
        },

        adoptPlatformSpeed(speed) {
            const video = HSE_Intel.getVideo();
            if (this.isLiveVideo || HSE_Intel.isLive(video)) {
                return;
            }

            const clamped = sanitizeSpeed(speed, 1.0);
            if (clamped < 0.25) return;
            if (Math.abs(this.currentSpeed - clamped) < 0.01) return;

            this.currentSpeed = clamped;
            document.documentElement.dataset.hsePlaybackRate = String(clamped);

            const info = HSE_Intel.getContentInfo();
            HSE_Store.setSpeedForShow(info.id, clamped);
            HSE_Store.recordUserSpeed(clamped);

            if (HSE_SmartPace.isActive) {
                HSE_SmartPace.stop(false);
            }

            HSE_UI.update();
            HSE_UI.flash(clamped + 'x');
        },

        syncContentSpeed() {
            if (HSE_SmartPace.isActive) return;
            const video = HSE_Intel.getVideo();
            const isLive = HSE_Intel.isLive(video);

            if (isLive) {
                this.isLiveVideo = true;
                this.wasLiveVideo = true;
                this.currentSpeed = 1.0;
                document.documentElement.dataset.hsePlaybackRate = '1';
                document.documentElement.dataset.hseIsLive = 'true';
                if (video) {
                    try {
                        video.playbackRate = 1.0;
                        video.defaultPlaybackRate = 1.0;
                    } catch (_) {}
                }
                try {
                    window.dispatchEvent(new CustomEvent('hs-live-status-change', { detail: { isLive: true } }));
                } catch (_) {}
                HSE_UI.update();
                return;
            }

            const info = HSE_Intel.getContentInfo();
            if (info.id === this.lastContentId && !this.wasLiveVideo) return;
            this.lastContentId = info.id;
            this.wasLiveVideo = false;

            // When navigating to a new episode/content, maintain the active user speed!
            const targetSpeed = (this.currentSpeed >= 0.25)
                ? this.currentSpeed
                : HSE_Store.getSpeedForShow(info.id);

            this.setSpeed(targetSpeed, true, false);
            HSE_UI.update();
        },

        enforce() {
            const video = HSE_Intel.getVideo();
            const isLive = HSE_Intel.isLive(video);
            this.isLiveVideo = isLive;
            document.documentElement.dataset.hseIsLive = isLive ? 'true' : 'false';

            if (isLive) {
                this.wasLiveVideo = true;
                // Live video must stay at normal speed (1.0x)
                if (HSE_SmartPace.isActive) {
                    HSE_SmartPace.stop(false);
                }

                if (Math.abs(this.currentSpeed - 1.0) > 0.01) {
                    this.currentSpeed = 1.0;
                    document.documentElement.dataset.hsePlaybackRate = '1';
                    try {
                        window.dispatchEvent(new CustomEvent('hs-speed-change', { detail: { speed: 1.0 } }));
                        window.dispatchEvent(new CustomEvent('hs-live-status-change', { detail: { isLive: true } }));
                    } catch (_) {}
                    HSE_UI.flash('Live Video: Auto-set to 1.0x Normal Speed', true);
                    HSE_UI.update();
                }

                if (video) {
                    const currentRate = video.playbackRate;
                    if (Number.isFinite(currentRate) && Math.abs(currentRate - 1.0) > 0.05) {
                        try {
                            video.playbackRate = 1.0;
                            if (video.defaultPlaybackRate !== 1.0) {
                                video.defaultPlaybackRate = 1.0;
                            }
                        } catch (_) {}
                    }
                    if (video.preservesPitch === false) {
                        try { video.preservesPitch = true; } catch (_) {}
                    }
                }

                HSE_UI.updateStatus('LIVE • 1.0x Normal Speed');
                HSE_UI.updateLiveUI(true);
                return;
            }

            HSE_UI.updateLiveUI(false);

            if (!HSE_SmartPace.isActive) {
                this.syncContentSpeed();
            } else {
                HSE_SmartPace.tick();
            }

            if (!video) return;

            const target = this.currentSpeed;
            if (Number.isFinite(target) && target >= 0.25) {
                const currentRate = video.playbackRate;
                if (Math.abs(currentRate - target) > 0.01) {
                    try {
                        video.playbackRate = target;
                        if (video.defaultPlaybackRate !== target) {
                            video.defaultPlaybackRate = target;
                        }
                    } catch (_) {}
                }
                if (video.preservesPitch === false) {
                    try {
                        video.preservesPitch = true;
                    } catch (_) {}
                }
            }
            HSE_UI.updateStatus();
        }
    };

    // --- HSE_SmartPace: Finish-Time / Adaptive Controller (v2.4 Addition) ---
    const HSE_SmartPace = {
        isActive: false,
        targetMinutes: 30,
        targetEndTime: 0,
        pauseStartTime: 0,
        totalPauseMs: 0,
        lastAdjustedSpeed: 1.0,
        lastAdjustmentTime: 0,
        MIN_SPEED_DELTA: 0.05,
        MIN_ADJUST_INTERVAL_MS: 2000,

        start(minutes) {
            const video = HSE_Intel.getVideo();
            if (HSE_Intel.isLive(video)) {
                HSE_UI.flash('Smart Pace is not available for live streams');
                return;
            }

            if (!video || !Number.isFinite(video.duration) || video.duration <= 0 || video.duration === Infinity) {
                HSE_UI.flash('Start playback first');
                return;
            }

            this.targetMinutes = Math.max(1, Math.min(600, Number(minutes) || 30));
            const wallSec = this.targetMinutes * 60;
            this.targetEndTime = Date.now() + (wallSec * 1000);
            this.pauseStartTime = 0;
            this.totalPauseMs = 0;
            this.isActive = true;
            this.lastAdjustmentTime = 0;

            this.attachVideoListeners(video);
            this.tick(true);
            HSE_UI.flash(`Smart Pace: ${this.targetMinutes}m target`);
            HSE_UI.update();
        },

        stop(flashNotice = true) {
            if (!this.isActive) return;
            this.isActive = false;
            this.pauseStartTime = 0;
            if (flashNotice) {
                HSE_UI.flash('Smart Pace stopped');
            }
            HSE_UI.update();
        },

        attachVideoListeners(video) {
            if (!video || video.__hse_smart_pace_listeners__) return;
            video.__hse_smart_pace_listeners__ = true;

            // When paused: freeze timer so wall time does not deplete
            video.addEventListener('pause', () => {
                if (this.isActive && !this.pauseStartTime) {
                    this.pauseStartTime = Date.now();
                }
            });

            // When resumed: advance targetEndTime by paused duration
            video.addEventListener('play', () => {
                if (this.isActive && this.pauseStartTime) {
                    const pausedDuration = Date.now() - this.pauseStartTime;
                    this.targetEndTime += pausedDuration;
                    this.totalPauseMs += pausedDuration;
                    this.pauseStartTime = 0;
                    this.tick(true);
                }
            });

            // When user seeks forward/back: recalculate required speed
            video.addEventListener('seeked', () => {
                if (this.isActive) {
                    this.tick(true);
                }
            });
        },

        calculateRequiredSpeed(video) {
            if (!video || !Number.isFinite(video.duration) || video.duration <= 0 || video.duration === Infinity) return null;
            const remainingVideoSec = Math.max(0, video.duration - video.currentTime);
            // Frozen wall time if paused
            const effectiveNow = this.pauseStartTime ? this.pauseStartTime : Date.now();
            const remainingWallSec = Math.max(1, (this.targetEndTime - effectiveNow) / 1000);
            const req = remainingVideoSec / remainingWallSec;
            return Math.min(MAX_SPEED, Math.max(0.25, Math.round(req * 100) / 100));
        },

        tick(force = false) {
            if (!this.isActive) return;
            const video = HSE_Intel.getVideo();
            if (!video) return;

            this.attachVideoListeners(video);

            // Don't adjust while video is paused
            if (video.paused && !force) {
                return;
            }

            const req = this.calculateRequiredSpeed(video);
            if (!req) return;

            const now = Date.now();
            const diff = Math.abs(req - HSE_Engine.currentSpeed);
            const timeSinceLast = now - this.lastAdjustmentTime;

            if (force || (diff >= this.MIN_SPEED_DELTA && timeSinceLast >= this.MIN_ADJUST_INTERVAL_MS)) {
                HSE_Engine.setSpeed(req, false, false);
                this.lastAdjustedSpeed = req;
                this.lastAdjustmentTime = now;
            }

            HSE_UI.updateSmartPaceStatus(req);
        }
    };

    // --- HSE_UI: Helpers & Icons ---
    function createSvgIcon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');

        if (name === 'gear') {
            svg.innerHTML = '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>';
        } else if (name === 'close') {
            svg.innerHTML = '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>';
        } else if (name === 'minus') {
            svg.innerHTML = '<line x1="5" y1="12" x2="19" y2="12"></line>';
        } else if (name === 'plus') {
            svg.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>';
        } else if (name === 'bolt') {
            svg.innerHTML = '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>';
        }
        return svg;
    }

    function makeDraggable(panel, handle) {
        let isDragging = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('button') || e.target.closest('.hse-header-btn')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            panel.style.left = `${initialLeft}px`;
            panel.style.top = `${initialTop}px`;
            panel.classList.add('is-dragging');

            const onMouseMove = (ev) => {
                if (!isDragging) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                const newLeft = Math.max(8, Math.min(window.innerWidth - rect.width - 8, initialLeft + dx));
                const newTop = Math.max(8, Math.min(window.innerHeight - rect.height - 8, initialTop + dy));
                panel.style.left = `${newLeft}px`;
                panel.style.top = `${newTop}px`;
            };

            const onMouseUp = () => {
                isDragging = false;
                panel.classList.remove('is-dragging');
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    // --- HSE_UI: Interface & Indicators ---
    const HSE_UI = {
        panel: null,
        hideTimer: null,
        flashTimer: null,

        init() {
            this.createIndicator();
            const existingBadge = document.getElementById('hse-player-badge');
            if (existingBadge) existingBadge.remove();
            window.addEventListener(TOGGLE_EVENT, () => this.toggle());

            document.addEventListener('fullscreenchange', () => {
                const fsTarget = document.fullscreenElement || document.body;
                const ind = document.getElementById('hse-flash-indicator');
                if (ind && ind.parentElement !== fsTarget) fsTarget.appendChild(ind);
                if (this.panel && this.panel.parentElement !== fsTarget) fsTarget.appendChild(this.panel);
            });
        },

        getMountElement() {
            return document.fullscreenElement ||
                   document.querySelector('#movie_player, ytd-player, .player-container, [data-testid="player-container"], .video-container, .shaka-video-container') ||
                   document.body;
        },

        createIndicator() {
            let ind = document.getElementById('hse-flash-indicator');
            const mount = this.getMountElement();
            if (!ind) {
                ind = document.createElement('div');
                ind.id = 'hse-flash-indicator';
                const iconSpan = document.createElement('span');
                iconSpan.className = 'hse-flash-icon';
                iconSpan.appendChild(createSvgIcon('bolt'));
                const textSpan = document.createElement('span');
                textSpan.id = 'hse-flash-text';
                ind.appendChild(iconSpan);
                ind.appendChild(textSpan);
                mount.appendChild(ind);
            } else if (ind.parentElement !== mount) {
                mount.appendChild(ind);
            }
            return ind;
        },

        flash(text, isLong = false) {
            const ind = this.createIndicator();
            if (!ind) return;
            const textSpan = ind.querySelector('#hse-flash-text');
            if (textSpan) {
                textSpan.textContent = text;
            } else {
                ind.textContent = text;
            }
            ind.classList.add('is-visible');
            if (this.flashTimer) clearTimeout(this.flashTimer);
            this.flashTimer = setTimeout(() => ind.classList.remove('is-visible'), isLong ? 2200 : 900);
        },

        toggle() {
            if (this.panel) {
                this.remove();
            } else {
                this.build();
            }
        },

        build() {
            if (this.panel) this.panel.remove();

            const isLive = HSE_Engine.isLiveVideo || HSE_Intel.isLive();
            const info = HSE_Intel.getContentInfo();

            if (isLive) {
                HSE_Engine.currentSpeed = 1.0;
            } else {
                const targetSpeed = (HSE_Engine.currentSpeed >= 0.25)
                    ? HSE_Engine.currentSpeed
                    : HSE_Store.getSpeedForShow(info.id);
                HSE_Engine.currentSpeed = targetSpeed;
            }
            HSE_Engine.lastContentId = info.id;

            const panel = document.createElement('div');
            panel.id = 'hs-speed-panel';
            panel.className = isLive ? 'mode-live' : 'mode-vod';

            // --- Header (Draggable) ---
            const header = document.createElement('div');
            header.id = 'hs-speed-header';

            const headerLeft = document.createElement('div');
            headerLeft.className = 'hse-header-left';

            const badge = document.createElement('span');
            badge.className = 'hse-badge';
            const dot = document.createElement('span');
            dot.className = 'hse-badge-dot';
            const badgeText = document.createElement('span');
            badgeText.textContent = Platform.label;
            badge.appendChild(dot);
            badge.appendChild(badgeText);

            const liveBadge = document.createElement('span');
            liveBadge.className = 'hse-live-badge';
            liveBadge.id = 'hse-header-live-badge';
            const liveDot = document.createElement('span');
            liveDot.className = 'hse-live-dot';
            const liveText = document.createElement('span');
            liveText.textContent = 'LIVE';
            liveBadge.appendChild(liveDot);
            liveBadge.appendChild(liveText);
            liveBadge.style.display = isLive ? 'inline-flex' : 'none';

            const titleEl = document.createElement('span');
            titleEl.id = 'hs-speed-title';
            titleEl.textContent = info.title;
            titleEl.title = info.title;

            headerLeft.appendChild(badge);
            headerLeft.appendChild(liveBadge);
            headerLeft.appendChild(titleEl);

            const actions = document.createElement('div');
            actions.className = 'hse-header-actions';

            const settingsBtn = document.createElement('button');
            settingsBtn.className = 'hse-header-btn';
            settingsBtn.title = 'Open Settings (Preferences)';
            settingsBtn.appendChild(createSvgIcon('gear'));
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
                        chrome.runtime.sendMessage({ action: 'openOptionsPage' }).catch(err => {
                            console.warn('OTT SPEED PLAYBACK: Failed to open options page.', err);
                        });
                    }
                } catch (err) {
                    console.warn('OTT SPEED PLAYBACK: Cannot open options page, context invalidated.', err);
                }
            });

            const closeBtn = document.createElement('button');
            closeBtn.className = 'hse-header-btn hse-close-btn';
            closeBtn.title = 'Close Speed Overlay';
            closeBtn.appendChild(createSvgIcon('close'));
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.remove();
            });

            actions.appendChild(settingsBtn);
            actions.appendChild(closeBtn);

            header.appendChild(headerLeft);
            header.appendChild(actions);

            makeDraggable(panel, header);

            // --- Hero Speed Controller Section ---
            const heroSection = document.createElement('div');
            heroSection.className = 'hse-hero-section';

            const btnMinus = document.createElement('button');
            btnMinus.className = 'hse-stepper-btn';
            btnMinus.disabled = isLive;
            btnMinus.title = isLive ? 'Speed locked to 1.0x for live video' : 'Decrease speed by 0.1x (Hotkey: [ )';
            btnMinus.appendChild(createSvgIcon('minus'));
            btnMinus.onclick = () => {
                if (HSE_Engine.isLiveVideo || HSE_Intel.isLive()) return;
                HSE_Engine.setSpeed(Math.max(0.25, +(HSE_Engine.currentSpeed - 0.1).toFixed(2)), true, true);
                this.resetHideTimer();
            };

            const heroDisplay = document.createElement('div');
            heroDisplay.className = 'hse-hero-display';

            const heroVal = document.createElement('span');
            heroVal.id = 'hse-hero-speed';
            heroVal.textContent = isLive ? '1' : HSE_Engine.currentSpeed.toFixed(2).replace(/\.00$/, '');

            const heroUnit = document.createElement('span');
            heroUnit.className = 'hse-hero-unit';
            heroUnit.textContent = 'x';

            heroDisplay.appendChild(heroVal);
            heroDisplay.appendChild(heroUnit);

            const btnPlus = document.createElement('button');
            btnPlus.className = 'hse-stepper-btn';
            btnPlus.disabled = isLive;
            btnPlus.title = isLive ? 'Speed locked to 1.0x for live video' : 'Increase speed by 0.1x (Hotkey: ] )';
            btnPlus.appendChild(createSvgIcon('plus'));
            btnPlus.onclick = () => {
                if (HSE_Engine.isLiveVideo || HSE_Intel.isLive()) return;
                HSE_Engine.setSpeed(Math.min(MAX_SPEED, +(HSE_Engine.currentSpeed + 0.1).toFixed(2)), true, true);
                this.resetHideTimer();
            };

            heroSection.appendChild(btnMinus);
            heroSection.appendChild(heroDisplay);
            heroSection.appendChild(btnPlus);

            // Sub-hero row: 1.0x Normal quick-reset + status
            const subHeroRow = document.createElement('div');
            subHeroRow.className = 'hse-subhero-row';

            const resetPill = document.createElement('button');
            resetPill.className = 'hse-reset-pill';
            resetPill.title = 'Reset to 1.0x Normal Speed (Hotkey: r)';
            resetPill.textContent = '1.0x Normal';
            resetPill.onclick = () => {
                HSE_Engine.setSpeed(1.0, true, true);
                this.resetHideTimer();
            };

            const statusText = document.createElement('span');
            statusText.id = 'hs-speed-status';
            statusText.textContent = isLive ? 'LIVE • 1.0x Normal Speed' : `${HSE_Engine.currentSpeed}x Active`;

            subHeroRow.appendChild(resetPill);
            subHeroRow.appendChild(statusText);

            // --- Presets Segmented Row ---
            const btnContainer = document.createElement('div');
            btnContainer.className = 'hs-speed-btn-container';

            DEFAULT_SPEEDS.forEach((s) => {
                const btn = document.createElement('button');
                btn.className = 'hs-speed-btn';
                if (isLive) {
                    btn.disabled = (s !== 1);
                    if (s === 1) btn.classList.add('is-active');
                } else if (Math.abs(s - HSE_Engine.currentSpeed) < 0.01) {
                    btn.classList.add('is-active');
                }
                btn.dataset.speed = String(s);
                btn.textContent = `${s}x`;
                btn.onclick = () => {
                    if (isLive && s !== 1) return;
                    HSE_Engine.setSpeed(parseFloat(btn.dataset.speed), true, true);
                    this.resetHideTimer();
                };
                btnContainer.appendChild(btn);
            });

            // --- Smart Pace Finish-Time Card ---
            const smartSec = document.createElement('div');
            smartSec.className = isLive ? 'hs-smart-pace-section is-live-disabled' : 'hs-smart-pace-section';

            const smartHeader = document.createElement('div');
            smartHeader.className = 'hs-smart-pace-header';

            const smartTitleGroup = document.createElement('div');
            smartTitleGroup.className = 'hs-smart-title-group';
            smartTitleGroup.appendChild(createSvgIcon('bolt'));
            const smartTitleText = document.createElement('span');
            smartTitleText.textContent = 'Smart Pace Autopilot';
            smartTitleGroup.appendChild(smartTitleText);

            const smartBadge = document.createElement('span');
            smartBadge.id = 'hse-smart-badge';
            smartBadge.className = HSE_SmartPace.isActive ? 'hse-smart-badge active' : 'hse-smart-badge';
            smartBadge.textContent = HSE_SmartPace.isActive ? 'Active' : 'Target';

            smartHeader.appendChild(smartTitleGroup);
            smartHeader.appendChild(smartBadge);

            const chipsRow = document.createElement('div');
            chipsRow.className = 'hs-smart-chips-row';
            [20, 30, 45, 60].forEach((m) => {
                const chip = document.createElement('button');
                chip.className = 'hs-smart-chip';
                chip.textContent = `${m}m`;
                chip.onclick = () => {
                    if (HSE_Engine.isLiveVideo || HSE_Intel.isLive()) return;
                    const inp = document.getElementById('hs-smart-input');
                    if (inp) inp.value = m;
                    HSE_SmartPace.start(m);
                    this.resetHideTimer();
                };
                chipsRow.appendChild(chip);
            });

            const inputRow = document.createElement('div');
            inputRow.className = 'hs-smart-input-row';

            const inputWrap = document.createElement('div');
            inputWrap.className = 'hs-smart-input-wrap';

            const input = document.createElement('input');
            input.type = 'number';
            input.id = 'hs-smart-input';
            input.min = '1';
            input.max = '600';
            input.value = String(HSE_SmartPace.targetMinutes || 30);

            const unitSpan = document.createElement('span');
            unitSpan.className = 'hs-smart-unit';
            unitSpan.textContent = 'min';

            inputWrap.appendChild(input);
            inputWrap.appendChild(unitSpan);

            const startBtn = document.createElement('button');
            startBtn.id = 'hs-smart-start-btn';
            startBtn.className = 'hs-smart-btn hs-smart-start';
            startBtn.textContent = HSE_SmartPace.isActive ? 'Update' : 'Start';
            startBtn.onclick = () => {
                if (HSE_Engine.isLiveVideo || HSE_Intel.isLive()) return;
                const val = parseInt(input.value, 10) || 30;
                HSE_SmartPace.start(val);
                this.resetHideTimer();
            };

            const stopBtn = document.createElement('button');
            stopBtn.id = 'hs-smart-stop-btn';
            stopBtn.className = 'hs-smart-btn hs-smart-stop';
            stopBtn.textContent = 'Stop';
            stopBtn.onclick = () => {
                HSE_SmartPace.stop();
                this.resetHideTimer();
            };

            inputRow.appendChild(inputWrap);
            inputRow.appendChild(startBtn);
            inputRow.appendChild(stopBtn);

            const smartStatus = document.createElement('div');
            smartStatus.id = 'hs-smart-status';
            smartStatus.className = 'hs-smart-status';
            if (HSE_SmartPace.isActive) {
                smartStatus.textContent = `Smart Pace: ${HSE_Engine.currentSpeed.toFixed(2)}x (Target: ${HSE_SmartPace.targetMinutes}m)`;
            }

            smartSec.appendChild(smartHeader);
            smartSec.appendChild(chipsRow);
            smartSec.appendChild(inputRow);
            smartSec.appendChild(smartStatus);

            if (isLive) {
                const liveNotice = document.createElement('div');
                liveNotice.className = 'hse-live-notice';
                liveNotice.textContent = 'Live stream active — playback locked to 1.0x to prevent stream drop.';
                smartSec.appendChild(liveNotice);
            }

            panel.appendChild(header);
            panel.appendChild(heroSection);
            panel.appendChild(subHeroRow);
            panel.appendChild(btnContainer);
            panel.appendChild(smartSec);

            // Hover protection: user hovering over panel prevents auto-dismiss
            panel.addEventListener('mouseenter', () => {
                if (this.hideTimer) clearTimeout(this.hideTimer);
            });
            panel.addEventListener('mouseleave', () => {
                this.resetHideTimer();
            });

            document.body.appendChild(panel);
            this.panel = panel;

            this.resetHideTimer();
        },

        updateLiveUI(isLive) {
            if (!this.panel) return;
            this.panel.classList.toggle('mode-live', isLive);
            this.panel.classList.toggle('mode-vod', !isLive);

            const liveBadge = document.getElementById('hse-header-live-badge');
            if (liveBadge) {
                liveBadge.style.display = isLive ? 'inline-flex' : 'none';
            }

            const heroVal = document.getElementById('hse-hero-speed');
            if (heroVal && isLive) {
                heroVal.textContent = '1';
            }

            const stepperBtns = this.panel.querySelectorAll('.hse-stepper-btn');
            stepperBtns.forEach(btn => {
                btn.disabled = isLive;
                btn.title = isLive ? 'Speed locked to 1.0x for live video' : btn.title;
            });

            this.panel.querySelectorAll('.hs-speed-btn').forEach(btn => {
                const s = parseFloat(btn.dataset.speed);
                if (isLive) {
                    btn.disabled = (s !== 1);
                    btn.classList.toggle('is-active', s === 1);
                } else {
                    btn.disabled = false;
                }
            });

            const smartSec = this.panel.querySelector('.hs-smart-pace-section');
            if (smartSec) {
                smartSec.classList.toggle('is-live-disabled', isLive);
                let notice = smartSec.querySelector('.hse-live-notice');
                if (isLive) {
                    if (!notice) {
                        notice = document.createElement('div');
                        notice.className = 'hse-live-notice';
                        notice.textContent = 'Live stream active — playback locked to 1.0x to prevent stream drop.';
                        smartSec.appendChild(notice);
                    }
                } else if (notice) {
                    notice.remove();
                }
            }
        },

        update() {
            if (!this.panel) return;
            const isLive = HSE_Engine.isLiveVideo || HSE_Intel.isLive();
            this.updateLiveUI(isLive);

            const speed = HSE_Engine.currentSpeed;
            if (!isLive) {
                this.panel.querySelectorAll('.hs-speed-btn').forEach((btn) => {
                    btn.classList.toggle('is-active', Math.abs(parseFloat(btn.dataset.speed) - speed) < 0.01);
                });
            }

            const titleEl = document.getElementById('hs-speed-title');
            if (titleEl) {
                titleEl.textContent = HSE_Intel.getContentInfo().title;
                titleEl.title = titleEl.textContent;
            }

            const heroVal = document.getElementById('hse-hero-speed');
            if (heroVal) {
                heroVal.textContent = isLive ? '1' : speed.toFixed(2).replace(/\.00$/, '');
            }

            this.updateStatus();
            this.updateSmartPaceStatus(speed);
        },

        updateStatus(text) {
            const status = document.getElementById('hs-speed-status');
            if (status) {
                if (HSE_Engine.isLiveVideo || HSE_Intel.isLive()) {
                    status.textContent = 'LIVE • 1.0x Normal Speed';
                } else {
                    status.textContent = text || `${HSE_Engine.currentSpeed}x Active`;
                }
            }
        },

        updateSmartPaceStatus(reqSpeed) {
            const el = document.getElementById('hs-smart-status');
            const badge = document.getElementById('hse-smart-badge');
            if (el) {
                if (HSE_SmartPace.isActive && !(HSE_Engine.isLiveVideo || HSE_Intel.isLive())) {
                    const video = HSE_Intel.getVideo();
                    const remSec = (video && Number.isFinite(video.duration)) ? Math.max(0, Math.round(video.duration - video.currentTime)) : 0;
                    const remMin = Math.ceil(remSec / 60);
                    el.textContent = `${reqSpeed.toFixed(2)}x · ${remMin}m video left (${HSE_SmartPace.targetMinutes}m target)`;
                    if (badge) {
                        badge.className = 'hse-smart-badge active';
                        badge.textContent = 'Active';
                    }
                } else {
                    el.textContent = '';
                    if (badge) {
                        badge.className = 'hse-smart-badge';
                        badge.textContent = 'Target';
                    }
                }
            }
            const startBtn = document.getElementById('hs-smart-start-btn');
            if (startBtn) {
                startBtn.textContent = HSE_SmartPace.isActive ? 'Update' : 'Start';
            }
        },

        resetHideTimer() {
            if (this.hideTimer) clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
                if (this.panel) {
                    this.panel.classList.add('fade-out');
                    setTimeout(() => this.remove(), 350);
                }
            }, 5000);
        },

        remove() {
            if (this.panel) {
                this.panel.remove();
                this.panel = null;
            }
            if (this.hideTimer) clearTimeout(this.hideTimer);
        }
    };

    // --- HSE_Input: Keyboard ---
    const HSE_Input = {
        isSmartSpeedActive: false,
        preSmartSpeed: 1,

        formatKey(e) {
            if (e.key === ' ') return 'Space';
            if (e.key.length === 1) return e.key;
            return e.key;
        },

        init() {
            window.addEventListener('keydown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                    return;
                }

                const keyName = this.formatKey(e);
                const custom = HSE_Store.customSettings;
                const isLive = HSE_Engine.isLiveVideo || HSE_Intel.isLive();

                if (keyName === custom.keySmartSpeed && !this.isSmartSpeedActive && !e.repeat) {
                    if (isLive) {
                        HSE_UI.flash('Fast-forward disabled on live video');
                        return;
                    }
                    this.isSmartSpeedActive = true;
                    this.preSmartSpeed = HSE_Engine.currentSpeed;
                    HSE_Engine.setSpeed(custom.smartSpeedValue, false, true);
                    HSE_UI.flash(`Fast Forward ${custom.smartSpeedValue}x`, true);
                    return;
                }

                if (keyName === custom.keySpeedDown) {
                    if (isLive) {
                        HSE_UI.flash('Live video: 1.0x Normal Speed only');
                        return;
                    }
                    HSE_Engine.setSpeed(Math.max(0.25, +(HSE_Engine.currentSpeed - 0.1).toFixed(1)), true, true);
                } else if (keyName === custom.keySpeedUp) {
                    if (isLive) {
                        HSE_UI.flash('Live video: 1.0x Normal Speed only');
                        return;
                    }
                    HSE_Engine.setSpeed(Math.min(MAX_SPEED, +(HSE_Engine.currentSpeed + 0.1).toFixed(1)), true, true);
                } else if (keyName === custom.keyReset) {
                    HSE_Engine.setSpeed(1.0, true, true);
                } else if (keyName === custom.keySkipForward) {
                    if (isLive) {
                        HSE_UI.flash('Cannot skip forward on live video');
                        return;
                    }
                    const video = HSE_Intel.getVideo();
                    if (video) video.currentTime += 10;
                    HSE_UI.flash('+10s');
                } else if (keyName === custom.keySkipBack) {
                    const video = HSE_Intel.getVideo();
                    if (video) {
                        if (isLive && video.seekable && video.seekable.length > 0) {
                            video.currentTime = Math.max(video.seekable.start(0), video.currentTime - 10);
                        } else {
                            video.currentTime -= 10;
                        }
                    }
                    HSE_UI.flash('-10s');
                }
            });

            window.addEventListener('keyup', (e) => {
                const keyName = this.formatKey(e);
                const custom = HSE_Store.customSettings;

                if (keyName === custom.keySmartSpeed && this.isSmartSpeedActive) {
                    this.isSmartSpeedActive = false;
                    HSE_Engine.setSpeed(this.preSmartSpeed, false, true);
                    HSE_UI.flash(`${this.preSmartSpeed}x`);
                }
            });
        }
    };

    // --- INITIALIZATION ---
    async function init() {
        injectMainWorldScript();
        await HSE_Store.init();

        // Check if currently playing video is live
        const isLive = HSE_Intel.isLive();
        HSE_Engine.isLiveVideo = isLive;

        if (isLive) {
            HSE_Engine.currentSpeed = 1.0;
            document.documentElement.dataset.hseIsLive = 'true';
        } else {
            const initialSpeed = HSE_Store.getSpeedForShow(HSE_Intel.getContentInfo().id);
            HSE_Engine.currentSpeed = (initialSpeed >= 0.25) ? initialSpeed : 1.0;
            document.documentElement.dataset.hseIsLive = 'false';
        }
        document.documentElement.dataset.hsePlaybackRate = String(HSE_Engine.currentSpeed);

        HSE_UI.init();
        HSE_Input.init();

        setInterval(() => {
            HSE_Engine.enforce();
        }, REFRESH_MS);

        // Immediate check when video duration or state changes (vital for live stream initialization)
        window.addEventListener('durationchange', (e) => {
            if (e.target && e.target.tagName === 'VIDEO') {
                if (HSE_Intel.isLive(e.target)) {
                    HSE_Engine.enforce();
                }
            }
        }, true);

        window.addEventListener('playing', (e) => {
            if (e.target && e.target.tagName === 'VIDEO') {
                if (HSE_Intel.isLive(e.target)) {
                    HSE_Engine.enforce();
                }
            }
        }, true);

        // Adopt speed changes initiated by verified user interactions in native platform controls
        window.addEventListener('hs-platform-speed-change', (e) => {
            if (e.detail && Number.isFinite(e.detail.speed) && e.detail.speed >= 0.25) {
                HSE_Engine.adoptPlatformSpeed(e.detail.speed);
            }
        });

        // Re-enforce active speed on ratechange if video diverged without user intent
        window.addEventListener('ratechange', (e) => {
            if (e.target && e.target.tagName === 'VIDEO') {
                if (HSE_Intel.isLive(e.target)) {
                    if (Math.abs(e.target.playbackRate - 1.0) > 0.05) {
                        try {
                            e.target.playbackRate = 1.0;
                            if (e.target.defaultPlaybackRate !== 1.0) {
                                e.target.defaultPlaybackRate = 1.0;
                            }
                        } catch (_) {}
                    }
                    return;
                }

                const target = HSE_Engine.currentSpeed;
                if (Number.isFinite(target) && target >= 0.25) {
                    const rate = e.target.playbackRate;
                    if (Math.abs(rate - target) > 0.01) {
                        try {
                            e.target.playbackRate = target;
                            if (e.target.defaultPlaybackRate !== target) {
                                e.target.defaultPlaybackRate = target;
                            }
                            if (e.target.preservesPitch === false) {
                                e.target.preservesPitch = true;
                            }
                        } catch (_) {}
                    }
                }
            }
        }, true);

        const loadInitialSpeed = () => {
            HSE_Engine.lastContentId = null;
            HSE_Engine.syncContentSpeed();
        };

        window.addEventListener('popstate', loadInitialSpeed);
        window.addEventListener('yt-navigate-finish', () => setTimeout(loadInitialSpeed, 150));
        window.addEventListener('yt-page-data-updated', () => setTimeout(loadInitialSpeed, 150));

        const originalPush = history.pushState;
        history.pushState = function () {
            originalPush.apply(this, arguments);
            setTimeout(loadInitialSpeed, 300);
        };

        const originalReplace = history.replaceState;
        history.replaceState = function () {
            originalReplace.apply(this, arguments);
            setTimeout(loadInitialSpeed, 300);
        };

        loadInitialSpeed();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
