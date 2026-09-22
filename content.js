/**
 * OTT SPEED PLAYBACK (v2.4.0)
 * Playback rate control for Hotstar, JioHotstar, Netflix, Prime Video,
 * ZEE5, Airtel Xstream, JioCinema, SonyLIV, Aha, Hoichoi, Sun NXT, and MX Player.
 * Built strictly additively on the canonical v2.3 architecture with Smart Pace finish-time mode.
 */
(function () {
    'use strict';

    const ROOT_FLAG = 'hsSpeedBootedV2';
    const TOGGLE_EVENT = 'hs-speed-toggle-v2';
    const DEFAULT_SPEEDS = [1, 1.5, 1.75, 2, 2.5];
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

                if (raw.paceProfile && typeof raw.paceProfile === 'object') {
                    const avg = Number(raw.paceProfile.averageSpeed);
                    const cnt = Number(raw.paceProfile.sampleCount);
                    if (Number.isFinite(avg) && avg >= 0.1 && avg <= MAX_SPEED) {
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
                const payload = {
                    hse_settings: {
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
            // Titles are UI-only; never return fields meant for persistence beyond id.
            return { id, title, platform: Platform.id };
        },

        getVideo() {
            return pickLargestVideo(collectVideos(document, []));
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
        currentSpeed: 1,
        lastContentId: null,

        setSpeed(speed, isPersistent = true, isManual = false) {
            const clamped = sanitizeSpeed(speed);
            this.currentSpeed = clamped;
            document.documentElement.dataset.hsePlaybackRate = String(clamped);

            try {
                window.dispatchEvent(new CustomEvent('hs-speed-change', { detail: { speed: clamped } }));
            } catch (_) {}

            const video = HSE_Intel.getVideo();
            if (video) {
                if (Math.abs(video.playbackRate - clamped) > 0.01) {
                    video.playbackRate = clamped;
                }
                if (Math.abs(video.defaultPlaybackRate - clamped) > 0.01) {
                    video.defaultPlaybackRate = clamped;
                }
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
                HSE_UI.updateBadge();
            }
        },

        syncContentSpeed() {
            if (HSE_SmartPace.isActive) return;
            const info = HSE_Intel.getContentInfo();
            if (info.id === this.lastContentId) return;
            this.lastContentId = info.id;
            const saved = HSE_Store.getSpeedForShow(info.id);
            this.setSpeed(saved, false, false);
            HSE_UI.update();
            HSE_UI.updateBadge();
        },

        enforce() {
            if (!HSE_SmartPace.isActive) {
                this.syncContentSpeed();
            } else {
                HSE_SmartPace.tick();
            }

            const video = HSE_Intel.getVideo();
            if (!video) return;

            const target = this.currentSpeed;
            if (Math.abs(video.playbackRate - target) > 0.01) {
                this.setSpeed(target, false, false);
            }
            HSE_UI.updateStatus();
            HSE_UI.updateBadge();
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
            if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
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
            if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return null;
            const remainingVideoSec = Math.max(0, video.duration - video.currentTime);
            // Frozen wall time if paused
            const effectiveNow = this.pauseStartTime ? this.pauseStartTime : Date.now();
            const remainingWallSec = Math.max(1, (this.targetEndTime - effectiveNow) / 1000);
            const req = remainingVideoSec / remainingWallSec;
            return Math.min(MAX_SPEED, Math.max(0.1, Math.round(req * 100) / 100));
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

    // --- HSE_UI: Interface & Indicators ---
    const HSE_UI = {
        panel: null,
        hideTimer: null,
        flashTimer: null,

        init() {
            this.createIndicator();
            this.updateBadge();
            window.addEventListener(TOGGLE_EVENT, () => this.toggle());

            document.addEventListener('fullscreenchange', () => {
                const fsTarget = document.fullscreenElement || document.body;
                const ind = document.getElementById('hse-flash-indicator');
                if (ind && ind.parentElement !== fsTarget) fsTarget.appendChild(ind);
                if (this.panel && this.panel.parentElement !== fsTarget) fsTarget.appendChild(this.panel);
                const badge = document.getElementById('hse-player-badge');
                if (badge && badge.parentElement !== fsTarget) fsTarget.appendChild(badge);
            });
        },

        getMountElement() {
            return document.fullscreenElement ||
                   document.querySelector('.player-container, [data-testid="player-container"], .video-container, .shaka-video-container') ||
                   document.body;
        },

        createIndicator() {
            let ind = document.getElementById('hse-flash-indicator');
            const mount = this.getMountElement();
            if (!ind) {
                ind = document.createElement('div');
                ind.id = 'hse-flash-indicator';
                mount.appendChild(ind);
            } else if (ind.parentElement !== mount) {
                mount.appendChild(ind);
            }
            return ind;
        },

        createBadge() {
            let badge = document.getElementById('hse-player-badge');
            const video = HSE_Intel.getVideo();
            const parent = video ? (video.parentElement || document.body) : document.body;
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'hse-player-badge';
                badge.title = 'Current OTT Playback Speed (Click to open controls)';
                badge.onclick = (e) => {
                    e.stopPropagation();
                    this.toggle();
                };
                if (parent) parent.appendChild(badge);
            } else if (badge.parentElement !== parent && parent) {
                parent.appendChild(badge);
            }
            return badge;
        },

        updateBadge() {
            const badge = this.createBadge();
            if (!badge) return;
            const speed = HSE_Engine.currentSpeed;
            badge.textContent = `⚡ ${speed.toFixed(2)}x`;
            badge.classList.toggle('is-boosted', Math.abs(speed - 1.0) > 0.01);
        },

        flash(text, isLong = false) {
            const ind = this.createIndicator();
            if (!ind) return;
            ind.textContent = text;
            ind.classList.add('is-visible');
            if (this.flashTimer) clearTimeout(this.flashTimer);
            this.flashTimer = setTimeout(() => ind.classList.remove('is-visible'), isLong ? 2000 : 800);
            this.updateBadge();
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
                            console.warn('OTT SPEED PLAYBACK: Failed to open options page.', err);
                        });
                    }
                } catch (err) {
                    console.warn('OTT SPEED PLAYBACK: Cannot open options page, context invalidated.', err);
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
                    HSE_Engine.setSpeed(parseFloat(btn.dataset.speed), true, true);
                    this.resetHideTimer();
                };
                btnContainer.appendChild(btn);
            });

            // --- Smart Pace Finish-Time Section (Additive v2.4) ---
            const smartSec = document.createElement('div');
            smartSec.className = 'hs-smart-pace-section';

            const smartHeader = document.createElement('div');
            smartHeader.className = 'hs-smart-pace-header';
            smartHeader.textContent = 'Smart Pace (Finish In)';

            const chipsRow = document.createElement('div');
            chipsRow.className = 'hs-smart-chips-row';
            [20, 30, 45, 60].forEach((m) => {
                const chip = document.createElement('button');
                chip.className = 'hs-smart-chip';
                chip.textContent = `${m}m`;
                chip.onclick = () => {
                    const inp = document.getElementById('hs-smart-input');
                    if (inp) inp.value = m;
                    HSE_SmartPace.start(m);
                    this.resetHideTimer();
                };
                chipsRow.appendChild(chip);
            });

            const inputRow = document.createElement('div');
            inputRow.className = 'hs-smart-input-row';

            const input = document.createElement('input');
            input.type = 'number';
            input.id = 'hs-smart-input';
            input.min = '1';
            input.max = '600';
            input.value = String(HSE_SmartPace.targetMinutes || 30);

            const unitSpan = document.createElement('span');
            unitSpan.className = 'hs-smart-unit';
            unitSpan.textContent = 'min';

            const startBtn = document.createElement('button');
            startBtn.id = 'hs-smart-start-btn';
            startBtn.className = 'hs-smart-btn';
            startBtn.textContent = HSE_SmartPace.isActive ? 'Update' : 'Start';
            startBtn.onclick = () => {
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

            inputRow.appendChild(input);
            inputRow.appendChild(unitSpan);
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

            panel.appendChild(header);
            panel.appendChild(status);
            panel.appendChild(btnContainer);
            panel.appendChild(smartSec);

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
            this.updateSmartPaceStatus(speed);
        },

        updateStatus(text) {
            const status = document.getElementById('hs-speed-status');
            if (status) {
                status.textContent = text || `Current Speed: ${HSE_Engine.currentSpeed}x`;
            }
        },

        updateSmartPaceStatus(reqSpeed) {
            const el = document.getElementById('hs-smart-status');
            if (el) {
                if (HSE_SmartPace.isActive) {
                    const video = HSE_Intel.getVideo();
                    const remSec = (video && Number.isFinite(video.duration)) ? Math.max(0, Math.round(video.duration - video.currentTime)) : 0;
                    const remMin = Math.ceil(remSec / 60);
                    el.textContent = `Smart Pace: ${reqSpeed.toFixed(2)}x (${remMin}m video left)`;
                } else {
                    el.textContent = '';
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
                    setTimeout(() => this.remove(), 400);
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

                if (keyName === custom.keySmartSpeed && !this.isSmartSpeedActive && !e.repeat) {
                    this.isSmartSpeedActive = true;
                    this.preSmartSpeed = HSE_Engine.currentSpeed;
                    HSE_Engine.setSpeed(custom.smartSpeedValue, false, true);
                    HSE_UI.flash(`Fast Forward ${custom.smartSpeedValue}x`, true);
                    return;
                }

                if (keyName === custom.keySpeedDown) {
                    HSE_Engine.setSpeed(Math.max(0.1, +(HSE_Engine.currentSpeed - 0.1).toFixed(1)), true, true);
                } else if (keyName === custom.keySpeedUp) {
                    HSE_Engine.setSpeed(Math.min(MAX_SPEED, +(HSE_Engine.currentSpeed + 0.1).toFixed(1)), true, true);
                } else if (keyName === custom.keyReset) {
                    HSE_Engine.setSpeed(1.0, true, true);
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
