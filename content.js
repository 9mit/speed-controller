/**
 * OTT SPEED PLAYBACK (v2.1)
 * Playback rate control for Hotstar, JioHotstar, Netflix, and Prime Video.
 */
(function () {
    'use strict';

    const ROOT_FLAG = 'hsSpeedBootedV2';
    const TOGGLE_EVENT = 'hs-speed-toggle-v2';
    const DEFAULT_SPEEDS = [1, 1.5, 2, 2.5];
    const REFRESH_MS = 1000;
    const MAX_SPEED = 16;
    const SMART_PACE_MIN_SPEED = 1;
    const SMART_PACE_TICK_MS = 1000;
    const DEFAULT_FINISH_MINUTES = 30;
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
            showSpeeds: {},
            paceProfile: {
                global: { averageSpeed: 1.5, samples: 0 },
                platforms: {}
            }
        },
        customSettings: {
            keySpeedUp: ']',
            keySpeedDown: '[',
            keyReset: 'r',
            keySkipForward: 'ArrowRight',
            keySkipBack: 'ArrowLeft',
            keySmartSpeed: 'Shift',
            smartSpeedValue: 2.0,
            finishMinutes: DEFAULT_FINISH_MINUTES
        },

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
                const rawProfile = raw.paceProfile;
                if (rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)) {
                    const global = rawProfile.global;
                    if (global && typeof global === 'object') {
                        const averageSpeed = sanitizeSpeed(global.averageSpeed, 1.5);
                        const samples = Number.isFinite(global.samples) ? Math.max(0, Math.min(10000, Math.floor(global.samples))) : 0;
                        this.settings.paceProfile.global = { averageSpeed, samples };
                    }
                    const platforms = rawProfile.platforms;
                    if (platforms && typeof platforms === 'object' && !Array.isArray(platforms)) {
                        const cleanedPlatforms = {};
                        for (const [platformId, profile] of Object.entries(platforms)) {
                            if (!/^[a-z0-9_-]+$/i.test(platformId)) continue;
                            if (!profile || typeof profile !== 'object') continue;
                            cleanedPlatforms[platformId] = {
                                averageSpeed: sanitizeSpeed(profile.averageSpeed, 1.5),
                                samples: Number.isFinite(profile.samples) ? Math.max(0, Math.min(10000, Math.floor(profile.samples))) : 0
                            };
                        }
                        this.settings.paceProfile.platforms = cleanedPlatforms;
                    }
                }
            }

            if (customRaw && typeof customRaw === 'object') {
                this.customSettings = { ...this.customSettings, ...customRaw };
                this.customSettings.smartSpeedValue = parseFloat(this.customSettings.smartSpeedValue) || 2.0;
                this.customSettings.finishMinutes = Number.isFinite(Number(this.customSettings.finishMinutes))
                    ? Math.max(1, Math.min(600, Math.round(Number(this.customSettings.finishMinutes))))
                    : DEFAULT_FINISH_MINUTES;
            }
        },

        async init() {
            try {
                if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime?.id) return;
                const result = await chrome.storage.local.get(['hse_settings', 'hse_custom_settings']);
                this.hydrateFromStorage(result.hse_settings, result.hse_custom_settings);
            } catch (_) {}
        },

        async save() {
            try {
                if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime?.id) return;
                await chrome.storage.local.set({
                    hse_settings: {
                        globalSpeed: this.settings.globalSpeed,
                        showSpeeds: this.settings.showSpeeds,
                        paceProfile: this.settings.paceProfile
                    }
                });
            } catch (_) {}
        },

        async saveCustom() {
            try {
                if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime?.id) return;
                await chrome.storage.local.set({ hse_custom_settings: this.customSettings });
            } catch (_) {}
        },

        storageKey(showId) {
            return `${Platform.id}:${showId}`;
        },

        getSpeedForShow(showId) {
            const key = this.storageKey(showId);
            if (this.settings.showSpeeds[key] != null) return this.settings.showSpeeds[key];
            if (Platform.id === 'hotstar' && this.settings.showSpeeds[showId] != null) return this.settings.showSpeeds[showId];
            return this.getPersonalPace();
        },

        setSpeedForShow(showId, speed) {
            this.settings.showSpeeds[this.storageKey(showId)] = sanitizeSpeed(speed);
            this.save();
        },

        getPersonalPace() {
            const platformProfile = this.settings.paceProfile.platforms[Platform.id];
            if (platformProfile && platformProfile.samples > 0) {
                return sanitizeSpeed(platformProfile.averageSpeed, 1.5);
            }
            return sanitizeSpeed(this.settings.paceProfile.global.averageSpeed, 1.5);
        },

        recordManualSpeed(speed) {
            const clamped = sanitizeSpeed(speed, 1);
            const global = this.settings.paceProfile.global;
            const platform = this.settings.paceProfile.platforms[Platform.id] || { averageSpeed: clamped, samples: 0 };
            const alpha = platform.samples < 5 ? 0.35 : 0.15;
            platform.averageSpeed = sanitizeSpeed(platform.averageSpeed + alpha * (clamped - platform.averageSpeed), clamped);
            platform.samples = Math.min(10000, platform.samples + 1);
            const globalAlpha = global.samples < 10 ? 0.2 : 0.08;
            global.averageSpeed = sanitizeSpeed(global.averageSpeed + globalAlpha * (clamped - global.averageSpeed), clamped);
            global.samples = Math.min(10000, global.samples + 1);
            this.settings.paceProfile.platforms[Platform.id] = platform;
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
        smartPace: {
            enabled: false,
            targetEndAt: 0,
            targetSeconds: 0,
            startedAt: 0,
            preSmartSpeed: 1
        },

        setSpeed(speed, isPersistent = true, source = 'manual') {
            const video = HSE_Intel.getVideo();
            if (!video) return;
            const clamped = sanitizeSpeed(speed);
            this.currentSpeed = clamped;
            video.playbackRate = clamped;
            video.defaultPlaybackRate = clamped;

            if (isPersistent) {
                const info = HSE_Intel.getContentInfo();
                HSE_Store.setSpeedForShow(info.id, clamped);
                if (source === 'manual') HSE_Store.recordManualSpeed(clamped);
                HSE_UI.update();
                HSE_UI.flash(clamped + 'x');
            }
        },

        getPersonalPace() {
            return HSE_Store.getPersonalPace();
        },

        startSmartPace(minutes) {
            const video = HSE_Intel.getVideo();
            const requestedMinutes = Number(minutes);
            if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
                HSE_UI.flash('Video duration unavailable', true);
                return false;
            }

            const safeMinutes = Math.max(1, Math.min(600, requestedMinutes));
            const targetSeconds = safeMinutes * 60;
            const remainingVideoSeconds = Math.max(0, video.duration - video.currentTime);
            const minimumRequiredSpeed = remainingVideoSeconds / targetSeconds;

            if (minimumRequiredSpeed > MAX_SPEED) {
                HSE_UI.flash(`Need ${minimumRequiredSpeed.toFixed(1)}x (max ${MAX_SPEED}x)`, true);
                return false;
            }

            this.smartPace.enabled = true;
            this.smartPace.targetSeconds = targetSeconds;
            this.smartPace.startedAt = Date.now();
            this.smartPace.targetEndAt = Date.now() + targetSeconds * 1000;
            this.smartPace.preSmartSpeed = this.currentSpeed;
            this.tickSmartPace(true);
            HSE_Store.customSettings.finishMinutes = Math.round(safeMinutes);
            HSE_Store.saveCustom();
            HSE_UI.resetHideTimer();
            HSE_UI.flash(`Smart Pace: ${this.currentSpeed.toFixed(2)}x`, true);
            return true;
        },

        stopSmartPace(restore = true) {
            if (!this.smartPace.enabled) return;
            const restoreSpeed = this.smartPace.preSmartSpeed;
            this.smartPace.enabled = false;
            this.smartPace.targetEndAt = 0;
            this.smartPace.targetSeconds = 0;
            this.smartPace.startedAt = 0;
            if (restore) this.setSpeed(restoreSpeed, false, 'smart-pace-stop');
            HSE_UI.update();
        },

        tickSmartPace(force = false) {
            if (!this.smartPace.enabled) return;
            const video = HSE_Intel.getVideo();
            if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;

            const remainingVideoSeconds = Math.max(0, video.duration - video.currentTime);
            if (remainingVideoSeconds <= 0.5) {
                this.smartPace.enabled = false;
                HSE_UI.update();
                return;
            }

            const remainingWallSeconds = Math.max(0.5, (this.smartPace.targetEndAt - Date.now()) / 1000);
            const requiredSpeed = remainingVideoSeconds / remainingWallSeconds;
            const nextSpeed = Math.min(MAX_SPEED, Math.max(SMART_PACE_MIN_SPEED, requiredSpeed));

            if (force || Math.abs(nextSpeed - this.currentSpeed) >= 0.05) {
                this.setSpeed(nextSpeed, false, 'smart-pace');
            }
            HSE_UI.update();
        },

        getSmartPaceStatus() {
            if (!this.smartPace.enabled) {
                return `Current Speed: ${this.currentSpeed.toFixed(2)}x • Personal pace: ${this.getPersonalPace().toFixed(2)}x`;
            }

            const video = HSE_Intel.getVideo();
            if (!video || !Number.isFinite(video.duration)) return 'Smart Pace active';

            const remainingVideoSeconds = Math.max(0, video.duration - video.currentTime);
            const remainingWallSeconds = Math.max(0, (this.smartPace.targetEndAt - Date.now()) / 1000);
            const playbackMinutes = remainingVideoSeconds / Math.max(this.currentSpeed, 0.1) / 60;
            const savedMinutes = Math.max(0, (remainingVideoSeconds / 60) - playbackMinutes);

            if (remainingWallSeconds <= 0) return `Smart Pace: ${this.currentSpeed.toFixed(2)}x • catch-up mode`;

            return `Smart Pace: ${this.currentSpeed.toFixed(2)}x • ${Math.ceil(remainingWallSeconds / 60)}m left • ~${Math.floor(savedMinutes)}m saved`;
        },

        syncContentSpeed() {
            const info = HSE_Intel.getContentInfo();
            if (info.id === this.lastContentId) return;

            if (this.smartPace.enabled) this.stopSmartPace(false);

            this.lastContentId = info.id;
            const saved = HSE_Store.getSpeedForShow(info.id);
            this.setSpeed(saved, false, 'sync');
            HSE_UI.update();
        },

        enforce() {
            const video = HSE_Intel.getVideo();
            if (!video) return;

            this.syncContentSpeed();

            if (this.smartPace.enabled) {
                this.tickSmartPace();
            } else {
                const target = this.currentSpeed;
                if (Math.abs(video.playbackRate - target) > 0.01) {
                    this.setSpeed(target, false, 'enforce');
                }
            }
            HSE_UI.updateStatus(this.getSmartPaceStatus());
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
            if (this.panel) this.remove();
            else this.build();
        },

        makeButton(label, className, onClick) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = className;
            btn.textContent = label;
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                onClick();
            });
            return btn;
        },

        build() {
            if (this.panel) this.panel.remove();

            const info = HSE_Intel.getContentInfo();
            HSE_Engine.currentSpeed = HSE_Store.getSpeedForShow(info.id);
            HSE_Engine.lastContentId = info.id;

            const panel = document.createElement('div');
            panel.id = 'hs-speed-panel';
            panel.className = 'mode-vod';

            const header = document.createElement('div');
            header.id = 'hs-speed-header';

            const titleEl = document.createElement('span');
            titleEl.id = 'hs-speed-title';
            titleEl.textContent = info.title;

            const badge = document.createElement('span');
            badge.className = 'hse-badge';
            badge.textContent = Platform.label;

            const settingsBtn = document.createElement('button');
            settingsBtn.type = 'button';
            settingsBtn.className = 'hs-speed-settings-icon';
            settingsBtn.textContent = '⚙';
            settingsBtn.title = 'Open Settings';
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
                        chrome.runtime.sendMessage({ action: 'openOptionsPage' }).catch(() => {});
                    }
                } catch (_) {}
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

            const goalCard = document.createElement('div');
            goalCard.className = 'hse-goal-card';

            const goalTitle = document.createElement('div');
            goalTitle.className = 'hse-goal-title';
            goalTitle.textContent = '⚡ Smart Pace';

            const goalHint = document.createElement('div');
            goalHint.className = 'hse-goal-hint';
            goalHint.textContent = 'Tell us how much time you have. Playback speed adapts to hit the target.';

            const quickRow = document.createElement('div');
            quickRow.className = 'hse-goal-quick-row';
            [20, 30, 45, 60].forEach((minutes) => {
                const btn = this.makeButton(`${minutes}m`, 'hse-goal-quick-btn', () => {
                    const input = panel.querySelector('#hse-finish-minutes');
                    if (input) input.value = String(minutes);
                    HSE_Engine.startSmartPace(minutes);
                    this.resetHideTimer();
                });
                btn.dataset.minutes = String(minutes);
                quickRow.appendChild(btn);
            });

            const goalControls = document.createElement('div');
            goalControls.className = 'hse-goal-controls';

            const finishInput = document.createElement('input');
            finishInput.id = 'hse-finish-minutes';
            finishInput.type = 'number';
            finishInput.min = '1';
            finishInput.max = '600';
            finishInput.step = '1';
            finishInput.value = String(HSE_Store.customSettings.finishMinutes || DEFAULT_FINISH_MINUTES);
            finishInput.setAttribute('aria-label', 'Finish in minutes');

            const finishLabel = document.createElement('span');
            finishLabel.className = 'hse-minutes-label';
            finishLabel.textContent = 'min';

            const startBtn = this.makeButton('Start', 'hse-start-btn', () => {
                HSE_Engine.startSmartPace(finishInput.value);
                this.resetHideTimer();
            });

            const stopBtn = this.makeButton('Stop', 'hse-stop-btn', () => {
                HSE_Engine.stopSmartPace(true);
                this.resetHideTimer();
            });

            goalControls.appendChild(finishInput);
            goalControls.appendChild(finishLabel);
            goalControls.appendChild(startBtn);
            goalControls.appendChild(stopBtn);
            goalCard.appendChild(goalTitle);
            goalCard.appendChild(goalHint);
            goalCard.appendChild(quickRow);
            goalCard.appendChild(goalControls);

            const separator = document.createElement('div');
            separator.className = 'hse-section-label';
            separator.textContent = 'Manual speed';

            const btnContainer = document.createElement('div');
            btnContainer.className = 'hs-speed-btn-container';

            DEFAULT_SPEEDS.forEach((s) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'hs-speed-btn';
                if (Math.abs(s - HSE_Engine.currentSpeed) < 0.01) btn.classList.add('is-active');
                btn.dataset.speed = String(s);
                btn.textContent = `${s}x`;
                btn.onclick = () => {
                    if (HSE_Engine.smartPace.enabled) HSE_Engine.stopSmartPace(false);
                    HSE_Engine.setSpeed(parseFloat(btn.dataset.speed));
                    this.resetHideTimer();
                };
                btnContainer.appendChild(btn);
            });

            const personalHint = document.createElement('div');
            personalHint.id = 'hse-personal-hint';
            personalHint.textContent = `Personal pace learned locally: ${HSE_Store.getPersonalPace().toFixed(2)}x`;

            panel.appendChild(header);
            panel.appendChild(status);
            panel.appendChild(goalCard);
            panel.appendChild(separator);
            panel.appendChild(btnContainer);
            panel.appendChild(personalHint);
            document.body.appendChild(panel);
            this.panel = panel;
            this.update();
            this.resetHideTimer();
        },

        update() {
            if (!this.panel) return;
            const speed = HSE_Engine.currentSpeed;
            this.panel.querySelectorAll('.hs-speed-btn').forEach((btn) => {
                btn.classList.toggle('is-active', Math.abs(parseFloat(btn.dataset.speed) - speed) < 0.01);
            });
            this.panel.classList.toggle('hse-smart-active', HSE_Engine.smartPace.enabled);

            const titleEl = document.getElementById('hs-speed-title');
            if (titleEl) titleEl.textContent = HSE_Intel.getContentInfo().title;

            const hint = document.getElementById('hse-personal-hint');
            if (hint) hint.textContent = `Personal pace learned locally: ${HSE_Store.getPersonalPace().toFixed(2)}x`;

            const startBtn = this.panel.querySelector('.hse-start-btn');
            const stopBtn = this.panel.querySelector('.hse-stop-btn');
            if (startBtn) startBtn.disabled = HSE_Engine.smartPace.enabled;
            if (stopBtn) stopBtn.disabled = !HSE_Engine.smartPace.enabled;
        },

        updateStatus(text) {
            const status = document.getElementById('hs-speed-status');
            if (status) status.textContent = text || HSE_Engine.getSmartPaceStatus();
        },

        resetHideTimer() {
            if (this.hideTimer) clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
                if (this.panel) {
                    this.panel.classList.add('fade-out');
                    setTimeout(() => this.remove(), 400);
                }
            }, 6000);
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
                    HSE_Engine.setSpeed(custom.smartSpeedValue, false, 'smart-speed');
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
                    HSE_Engine.setSpeed(this.preSmartSpeed, false, 'smart-speed-stop');
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
        }, Math.min(REFRESH_MS, SMART_PACE_TICK_MS));

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
