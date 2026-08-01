/**
 * Stream Pro Speed (v2.1)
 * Playback rate control for Hotstar, JioHotstar, Netflix, and Prime Video.
 */
(function () {
    'use strict';

    const ROOT_FLAG = 'hsSpeedBootedV2';
    const TOGGLE_EVENT = 'hs-speed-toggle-v2';
    const DEFAULT_SPEEDS = [1, 1.5, 2, 2.5];
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

    function pickLargestVideo(videos) {
        const connected = videos.filter((v) => v.isConnected && v.readyState >= 1);
        const pool = connected.length ? connected : videos.filter((v) => v.isConnected);
        if (!pool.length) return videos[0] || null;
        return pool.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
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

    function sanitizeSpeed(value, fallback = 1) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(MAX_SPEED, Math.max(0.1, n));
    }

    // --- Platform adapters ---
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
            globalSpeed: 1,
            showSpeeds: {}
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
                if (typeof raw.globalSpeed === 'number') {
                    this.settings.globalSpeed = sanitizeSpeed(raw.globalSpeed, 1);
                }

                const speeds = raw.showSpeeds;
                if (speeds && typeof speeds === 'object' && !Array.isArray(speeds)) {
                    const cleaned = {};
                    for (const [key, value] of Object.entries(speeds)) {
                        if (typeof key !== 'string' || key.length > 64) continue;
                        if (!/^[a-z0-9:_-]+$/i.test(key)) continue;
                        if (typeof value !== 'number') continue;
                        cleaned[key] = sanitizeSpeed(value);
                    }
                    this.settings.showSpeeds = cleaned;
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
                console.warn('Stream Pro Speed: Extension context invalidated during init.', err);
            }
        },

        async save() {
            try {
                if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime?.id) {
                    return;
                }
                const payload = {
                    hse_settings: {
                        globalSpeed: this.settings.globalSpeed,
                        showSpeeds: this.settings.showSpeeds
                    }
                };
                await chrome.storage.local.set(payload);
            } catch (err) {
                console.warn('Stream Pro Speed: Extension context invalidated during save.', err);
            }
        },

        storageKey(showId) {
            return `${Platform.id}:${showId}`;
        },

        getSpeedForShow(showId) {
            const key = this.storageKey(showId);
            // Prefer platform-namespaced key; fall back to bare Hotstar IDs for migration
            if (this.settings.showSpeeds[key] != null) {
                return this.settings.showSpeeds[key];
            }
            if (Platform.id === 'hotstar' && this.settings.showSpeeds[showId] != null) {
                return this.settings.showSpeeds[showId];
            }
            return this.settings.globalSpeed;
        },

        setSpeedForShow(showId, speed) {
            this.settings.showSpeeds[this.storageKey(showId)] = sanitizeSpeed(speed);
            this.save();
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
            // Titles are UI-only; never return fields meant for persistence beyond id.
            return { id, title, platform: Platform.id };
        },

        getVideo() {
            return pickLargestVideo(collectVideos(document, []));
        }
    };

    // --- HSE_Engine: Action & Enforcement ---
    const HSE_Engine = {
        currentSpeed: 1,
        lastContentId: null,

        setSpeed(speed, isPersistent = true) {
            const video = HSE_Intel.getVideo();
            if (!video) return;

            const clamped = sanitizeSpeed(speed);
            this.currentSpeed = clamped;
            video.playbackRate = clamped;
            video.defaultPlaybackRate = clamped;

            if (isPersistent) {
                const info = HSE_Intel.getContentInfo();
                HSE_Store.setSpeedForShow(info.id, clamped);
                HSE_UI.update();
                HSE_UI.flash(clamped + 'x');
            }
        },

        syncContentSpeed() {
            const info = HSE_Intel.getContentInfo();
            if (info.id === this.lastContentId) return;
            this.lastContentId = info.id;
            const saved = HSE_Store.getSpeedForShow(info.id);
            this.setSpeed(saved, false);
            HSE_UI.update();
        },

        enforce() {
            const video = HSE_Intel.getVideo();
            if (!video) return;

            this.syncContentSpeed();

            const target = this.currentSpeed;
            if (Math.abs(video.playbackRate - target) > 0.01) {
                this.setSpeed(target, false);
            }
            HSE_UI.updateStatus();
        }
    };

    // --- HSE_UI: Interface & Indicators ---
    const HSE_UI = {
        panel: null,
        hideTimer: null,
        flashTimer: null,

        init() {
            this.createIndicator();
            window.addEventListener(TOGGLE_EVENT, () => this.toggle());
        },

        createIndicator() {
            const ind = document.createElement('div');
            ind.id = 'hse-flash-indicator';
            document.body.appendChild(ind);
        },

        flash(text, isLong = false) {
            const ind = document.getElementById('hse-flash-indicator');
            if (!ind) return;
            ind.textContent = text;
            ind.classList.add('is-visible');
            if (this.flashTimer) clearTimeout(this.flashTimer);
            this.flashTimer = setTimeout(() => ind.classList.remove('is-visible'), isLong ? 2000 : 800);
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

            const info = HSE_Intel.getContentInfo();
            HSE_Engine.currentSpeed = HSE_Store.getSpeedForShow(info.id);
            HSE_Engine.lastContentId = info.id;

            const panel = document.createElement('div');
            panel.id = 'hs-speed-panel';
            panel.className = 'mode-vod';

            // Build with DOM APIs — never interpolate page titles into innerHTML (XSS / leak surface).
            const header = document.createElement('div');
            header.id = 'hs-speed-header';

            const titleEl = document.createElement('span');
            titleEl.id = 'hs-speed-title';
            titleEl.textContent = info.title;

            const badge = document.createElement('span');
            badge.className = 'hse-badge';
            badge.textContent = Platform.label;

            const settingsBtn = document.createElement('span');
            settingsBtn.className = 'hs-speed-settings-icon';
            settingsBtn.innerHTML = '&#9881;';
            settingsBtn.title = 'Open Settings';
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
                        chrome.runtime.sendMessage({ action: 'openOptionsPage' }).catch(err => {
                            console.warn('Stream Pro Speed: Failed to open options page.', err);
                        });
                    }
                } catch (err) {
                    console.warn('Stream Pro Speed: Cannot open options page, context invalidated.', err);
                }
            });

            const badgesContainer = document.createElement('div');
            badgesContainer.className = 'hse-badges-container';
            badgesContainer.appendChild(badge);
            badgesContainer.appendChild(settingsBtn);

            header.appendChild(titleEl);
            header.appendChild(badgesContainer);

            const status = document.createElement('div');
            status.id = 'hs-speed-status';
            status.textContent = 'Initialising...';

            const btnContainer = document.createElement('div');
            btnContainer.className = 'hs-speed-btn-container';

            DEFAULT_SPEEDS.forEach((s) => {
                const btn = document.createElement('button');
                btn.className = 'hs-speed-btn';
                if (Math.abs(s - HSE_Engine.currentSpeed) < 0.01) {
                    btn.classList.add('is-active');
                }
                btn.dataset.speed = String(s);
                btn.textContent = `${s}x`;
                btn.onclick = () => {
                    HSE_Engine.setSpeed(parseFloat(btn.dataset.speed));
                    this.resetHideTimer();
                };
                btnContainer.appendChild(btn);
            });

            panel.appendChild(header);
            panel.appendChild(status);
            panel.appendChild(btnContainer);

            document.body.appendChild(panel);
            this.panel = panel;

            this.resetHideTimer();
        },

        update() {
            if (!this.panel) return;
            const speed = HSE_Engine.currentSpeed;
            this.panel.querySelectorAll('.hs-speed-btn').forEach((btn) => {
                btn.classList.toggle('is-active', Math.abs(parseFloat(btn.dataset.speed) - speed) < 0.01);
            });
            const titleEl = document.getElementById('hs-speed-title');
            if (titleEl) {
                titleEl.textContent = HSE_Intel.getContentInfo().title;
            }
        },

        updateStatus(text) {
            const status = document.getElementById('hs-speed-status');
            if (status) {
                status.textContent = text || `Current Speed: ${HSE_Engine.currentSpeed}x`;
            }
        },

        resetHideTimer() {
            if (this.hideTimer) clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
                if (this.panel) {
                    this.panel.classList.add('fade-out');
                    setTimeout(() => this.remove(), 400);
                }
            }, 4000);
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

                if (keyName === custom.keySmartSpeed && !this.isSmartSpeedActive && !e.repeat) {
                    this.isSmartSpeedActive = true;
                    this.preSmartSpeed = HSE_Engine.currentSpeed;
                    HSE_Engine.setSpeed(custom.smartSpeedValue, false);
                    HSE_UI.flash(`Fast Forward ${custom.smartSpeedValue}x`, true);
                    return;
                }

                if (keyName === custom.keySpeedDown) {
                    HSE_Engine.setSpeed(Math.max(0.1, +(HSE_Engine.currentSpeed - 0.1).toFixed(1)));
                } else if (keyName === custom.keySpeedUp) {
                    HSE_Engine.setSpeed(Math.min(MAX_SPEED, +(HSE_Engine.currentSpeed + 0.1).toFixed(1)));
                } else if (keyName === custom.keyReset) {
                    HSE_Engine.setSpeed(1.0);
                } else if (keyName === custom.keySkipForward) {
                    const video = HSE_Intel.getVideo();
                    if (video) video.currentTime += 10;
                    HSE_UI.flash('+10s');
                } else if (keyName === custom.keySkipBack) {
                    const video = HSE_Intel.getVideo();
                    if (video) video.currentTime -= 10;
                    HSE_UI.flash('-10s');
                }
            });

            window.addEventListener('keyup', (e) => {
                const keyName = this.formatKey(e);
                const custom = HSE_Store.customSettings;

                if (keyName === custom.keySmartSpeed && this.isSmartSpeedActive) {
                    this.isSmartSpeedActive = false;
                    HSE_Engine.setSpeed(this.preSmartSpeed, false);
                    HSE_UI.flash(`${this.preSmartSpeed}x`);
                }
            });
        }
    };

    // --- INITIALIZATION ---
    async function init() {
        await HSE_Store.init();
        HSE_UI.init();
        HSE_Input.init();

        setInterval(() => {
            HSE_Engine.enforce();
        }, REFRESH_MS);

        const loadInitialSpeed = () => {
            HSE_Engine.lastContentId = null;
            HSE_Engine.syncContentSpeed();
        };

        window.addEventListener('popstate', loadInitialSpeed);

        const originalPush = history.pushState;
        history.pushState = function () {
            originalPush.apply(this, arguments);
            setTimeout(loadInitialSpeed, 500);
        };

        const originalReplace = history.replaceState;
        history.replaceState = function () {
            originalReplace.apply(this, arguments);
            setTimeout(loadInitialSpeed, 500);
        };

        loadInitialSpeed();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
