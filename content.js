/**
 * OTT SPEED PLAYBACK (v4.0.0)
 * Content-Aware Adaptive Pace Engine & Playback Autopilot
 */
(function () {
    'use strict';

    const ROOT_FLAG = 'hsSpeedBootedV4';
    const TOGGLE_EVENT = 'hs-speed-toggle-v2';
    const REFRESH_MS = 1000;
    const MAX_SPEED = 16;
    const MIN_SPEED = 0.1;

    // Guard against multiple injections in the same frame
    if (document.documentElement.dataset[ROOT_FLAG] === 'true') {
        window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
        return;
    }
    document.documentElement.dataset[ROOT_FLAG] = 'true';

    // --- Helpers ---
    function sanitizeSpeed(value, fallback = 1) {
        if (value === null || value === undefined || value === '' || typeof value === 'boolean') return fallback;
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, n));
        return Math.round(clamped * 100) / 100;
    }

    function formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0s';
        const totalSec = Math.round(seconds);
        const hrs = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        if (hrs > 0) {
            return `${hrs}h ${mins}m`;
        }
        if (mins > 0) {
            return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
        }
        return `${secs}s`;
    }

    function cleanTitle(raw, suffixes = []) {
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

    // --- Video Discovery Across Regular & Shadow DOM ---
    function collectVideos(root, results = []) {
        if (!root) return results;
        try {
            if (root.querySelectorAll) {
                root.querySelectorAll('video').forEach((v) => results.push(v));
                root.querySelectorAll('*').forEach((el) => {
                    if (el.shadowRoot) collectVideos(el.shadowRoot, results);
                });
            }
        } catch (_) { /* cross-origin or closed shadow roots */ }
        return results;
    }

    function pickActiveVideo(videos) {
        if (!videos || !videos.length) return null;
        const connected = videos.filter((v) => v.isConnected);
        if (!connected.length) return videos[0] || null;

        // Prioritize actively playing video
        const playing = connected.find((v) => !v.paused && v.readyState >= 1);
        if (playing) return playing;

        const ready = connected.filter((v) => v.readyState >= 1);
        const pool = ready.length ? ready : connected;
        return pool.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || pool[0];
    }

    // --- Platform Adapters ---
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
            },
            getCaptionSelector() {
                return '.shaka-text-container, .bmpui-ui-subtitle-overlay, [class*="subtitle" i]';
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
            },
            getCaptionSelector() {
                return '.player-timedtext, .timed-text-container, [class*="player-timedtext"]';
            }
        },

        prime: {
            id: 'prime',
            label: 'Prime Video',
            match(hostname, pathname) {
                if (/(^|\.)primevideo\.com$/i.test(hostname)) return true;
                if (/(^|\.)amazon\./i.test(hostname)) {
                    return /\/gp\/video\b|\/detail\/|\/Prime-Video\b/i.test(pathname || '');
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
            },
            getCaptionSelector() {
                return '.timedTextBackground, .timedText, [data-automation-id="subtitle-overlay"]';
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
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) return last;
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [/\s*-\s*ZEE5\s*$/i, /\s*\|\s*ZEE5\s*$/i]);
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
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) return last;
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [/\s*-\s*Airtel Xstream.*$/i, /\s*\|\s*Airtel Xstream.*$/i]);
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
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) return last;
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [/\s*-\s*JioCinema\s*$/i, /\s*\|\s*JioCinema\s*$/i]);
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
                    if (/^[a-z0-9_-]+$/i.test(last) && last.length > 4) return last;
                }
                return 'generic';
            },
            getTitle() {
                return cleanTitle(document.title, [/\s*-\s*SonyLIV\s*$/i, /\s*\|\s*SonyLIV\s*$/i]);
            }
        },

        aha: {
            id: 'aha',
            label: 'Aha',
            match(hostname) { return /(^|\.)aha\.video$/i.test(hostname); },
            getContentId(pathname) {
                const parts = pathname.split('/').filter(Boolean);
                return parts.length > 0 ? parts[parts.length - 1] : 'generic';
            },
            getTitle() { return cleanTitle(document.title, [/\s*-\s*aha\s*$/i]); }
        },

        hoichoi: {
            id: 'hoichoi',
            label: 'Hoichoi',
            match(hostname) { return /(^|\.)hoichoi\.tv$/i.test(hostname); },
            getContentId(pathname) {
                const parts = pathname.split('/').filter(Boolean);
                return parts.length > 0 ? parts[parts.length - 1] : 'generic';
            },
            getTitle() { return cleanTitle(document.title, [/\s*-\s*hoichoi\s*$/i]); }
        },

        sunnxt: {
            id: 'sunnxt',
            label: 'Sun NXT',
            match(hostname) { return /(^|\.)sunnxt\.com$/i.test(hostname); },
            getContentId(pathname) {
                const parts = pathname.split('/').filter(Boolean);
                return parts.length > 0 ? parts[parts.length - 1] : 'generic';
            },
            getTitle() { return cleanTitle(document.title, [/\s*-\s*Sun NXT\s*$/i]); }
        },

        mxplayer: {
            id: 'mxplayer',
            label: 'MX Player',
            match(hostname) { return /(^|\.)mxplayer\.in$/i.test(hostname); },
            getContentId(pathname) {
                const parts = pathname.split('/').filter(Boolean);
                return parts.length > 0 ? parts[parts.length - 1] : 'generic';
            },
            getTitle() { return cleanTitle(document.title, [/\s*-\s*MX Player\s*$/i]); }
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
    if (!Platform) return;

    // --- HSE_Intel: Video & Pattern Analysis with Player Replacement Resilience ---
    const HSE_Intel = {
        cachedVideo: null,

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
            return { id, title, platform: Platform.id, platformLabel: Platform.label };
        },

        getVideo() {
            if (this.cachedVideo && this.cachedVideo.isConnected) {
                return this.cachedVideo;
            }
            const found = pickActiveVideo(collectVideos(document, []));
            if (found) {
                this.cachedVideo = found;
                this.attachVideoListeners(found);
            }
            return found;
        },

        attachVideoListeners(video) {
            if (!video || video.__hse_bound__) return;
            video.__hse_bound__ = true;

            video.addEventListener('play', () => HSE_AdaptiveEngine.handlePlay());
            video.addEventListener('pause', () => HSE_AdaptiveEngine.handlePause());
            video.addEventListener('seeking', () => HSE_AdaptiveEngine.handleSeek());
            video.addEventListener('seeked', () => HSE_AdaptiveEngine.handleSeek());
            video.addEventListener('ended', () => HSE_AdaptiveEngine.handleEnded());
        },

        findSubtitleElement() {
            try {
                const specific = Platform.getCaptionSelector ? Platform.getCaptionSelector() : null;
                if (specific) {
                    const el = document.querySelector(specific);
                    if (el) return el;
                }
                const generic = document.querySelector('[class*="subtitle" i], [class*="caption" i], [class*="timedtext" i], [class*="timed-text" i]');
                return generic;
            } catch (_) {
                return null;
            }
        }
    };

    // --- FEATURE 1, 2, 3: HSE_Analyzer (Content & Subtitle Intelligence) ---
    const HSE_Analyzer = {
        captionHistory: [], // { time, text, words }
        lastText: '',
        lastCaptionTimestamp: 0,
        silenceDurationSec: 0,
        lastAnalysisTime: 0,
        cachedResult: null,

        init() {
            this.setupObserver();
        },

        setupObserver() {
            // Lightweight polling/observer for subtitle changes
            setInterval(() => {
                const subEl = HSE_Intel.findSubtitleElement();
                if (!subEl) return;
                const text = (subEl.textContent || '').trim();
                const now = Date.now();

                if (text && text !== this.lastText) {
                    this.lastText = text;
                    this.lastCaptionTimestamp = now;
                    const words = text.split(/\s+/).filter(Boolean).length;
                    this.captionHistory.push({ time: now, text, words });
                    // Keep last 30 seconds of history
                    const cutoff = now - 30000;
                    this.captionHistory = this.captionHistory.filter(c => c.time >= cutoff);
                }
            }, 600);
        },

        analyze(video) {
            const now = Date.now();
            if (this.cachedResult && (now - this.lastAnalysisTime < 1000)) {
                return this.cachedResult;
            }
            this.lastAnalysisTime = now;

            if (!video) {
                this.cachedResult = {
                    difficulty: 0.5,
                    speechDensity: 0.5,
                    silenceRatio: 0.0,
                    captionDensity: 0.0,
                    visualChange: 0.0,
                    confidence: 0.2,
                    reason: 'Normal dialogue'
                };
                return this.cachedResult;
            }

            const currentTime = video.currentTime || 0;
            const duration = video.duration || 0;

            // 1. Intro & Credits Position Heuristics
            if (duration > 300) {
                // Ending credits: last 3 minutes or final 4% of duration with no captions
                if (currentTime > (duration - 180) || (currentTime / duration) > 0.96) {
                    this.cachedResult = {
                        difficulty: 0.1,
                        speechDensity: 0.0,
                        silenceRatio: 0.95,
                        captionDensity: 0.0,
                        visualChange: 0.0,
                        confidence: 0.9,
                        reason: 'Credits sequence'
                    };
                    return this.cachedResult;
                }
                // Opening sequence: first 90 seconds with silence
                if (currentTime < 90 && (now - this.lastCaptionTimestamp > 8000)) {
                    this.cachedResult = {
                        difficulty: 0.2,
                        speechDensity: 0.0,
                        silenceRatio: 0.85,
                        captionDensity: 0.0,
                        visualChange: 0.0,
                        confidence: 0.75,
                        reason: 'Intro / opening'
                    };
                    return this.cachedResult;
                }
            }

            // 2. Subtitle / Dialogue Density Analysis
            const recentCutoff = now - 15000; // last 15s window
            const recentSamples = this.captionHistory.filter(c => c.time >= recentCutoff);
            const hasRecentCaptions = (now - this.lastCaptionTimestamp) < 15000;

            let speechDensity = 0.5;
            let silenceRatio = 0.0;
            let confidence = 0.3; // low confidence fallback

            if (recentSamples.length > 0 || hasRecentCaptions) {
                confidence = 0.85;
                const totalWords = recentSamples.reduce((sum, s) => sum + s.words, 0);
                const wpm = (totalWords / 15) * 60; // Words Per Minute

                // Normalize speech density: 0 WPM -> 0.0, 100 WPM -> 0.5, 200+ WPM -> 1.0
                speechDensity = Math.min(1.0, Math.max(0.0, wpm / 200));

                const silenceGapMs = now - this.lastCaptionTimestamp;
                silenceRatio = Math.min(1.0, Math.max(0.0, silenceGapMs / 10000));
            } else {
                // No subtitles detected; assume standard baseline
                speechDensity = 0.45;
                silenceRatio = 0.1;
            }

            // 3. Difficulty Calculation & Semantic Reason
            let difficulty = 0.5;
            let reason = 'Normal dialogue';

            if (silenceRatio > 0.85) {
                difficulty = 0.1;
                reason = (now - this.lastCaptionTimestamp > 10000) ? 'Very long silence' : 'Long pause';
            } else if (silenceRatio > 0.55) {
                difficulty = 0.25;
                reason = 'Dialogue pause';
            } else if (speechDensity > 0.75) {
                difficulty = 0.85;
                reason = 'Dense dialogue';
            } else if (speechDensity > 0.5) {
                difficulty = 0.6;
                reason = 'Normal dialogue';
            } else if (speechDensity > 0.25) {
                difficulty = 0.4;
                reason = 'Simple conversation';
            } else {
                difficulty = 0.3;
                reason = 'Action / visual sequence';
            }

            this.cachedResult = {
                difficulty,
                speechDensity,
                silenceRatio,
                captionDensity: speechDensity,
                visualChange: 0.0,
                confidence,
                reason
            };
            return this.cachedResult;
        }
    };

    // --- FEATURE 6, 13: HSE_Store (Storage & Personal Pace Learning 2.0) ---
    const HSE_Store = {
        settings: {
            globalSpeed: 1,
            showSpeeds: {},
            presets: [1, 1.25, 1.5, 1.75, 2, 2.5],
            speedStep: 0.1,
            defaultFinishTarget: 30,
            adaptiveEnabled: true,
            learnOverrides: true
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
        paceProfile: {
            globalAverage: 1.65,
            sampleCount: 5,
            platforms: {},
            behavior: {
                tolerance: 0.18,
                preferredAcceleration: 0.85,
                preferredMaxSpeed: 2.8,
                manualOverrides: 0
            }
        },

        hydrateFromStorage(raw, customRaw, paceRaw) {
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                if (typeof raw.globalSpeed === 'number') this.settings.globalSpeed = sanitizeSpeed(raw.globalSpeed, 1);
                if (Array.isArray(raw.presets) && raw.presets.length) this.settings.presets = raw.presets.map((p) => sanitizeSpeed(p)).filter(Boolean);
                if (typeof raw.speedStep === 'number' && raw.speedStep > 0) this.settings.speedStep = Math.max(0.01, Math.min(1, raw.speedStep));
                if (typeof raw.defaultFinishTarget === 'number') this.settings.defaultFinishTarget = Math.max(1, raw.defaultFinishTarget);
                if (typeof raw.adaptiveEnabled === 'boolean') this.settings.adaptiveEnabled = raw.adaptiveEnabled;
                if (typeof raw.learnOverrides === 'boolean') this.settings.learnOverrides = raw.learnOverrides;

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

            if (paceRaw && typeof paceRaw === 'object') {
                if (typeof paceRaw.globalAverage === 'number') this.paceProfile.globalAverage = sanitizeSpeed(paceRaw.globalAverage, 1.65);
                if (typeof paceRaw.sampleCount === 'number') this.paceProfile.sampleCount = paceRaw.sampleCount;
                if (paceRaw.platforms && typeof paceRaw.platforms === 'object') this.paceProfile.platforms = paceRaw.platforms;
                if (paceRaw.behavior && typeof paceRaw.behavior === 'object') this.paceProfile.behavior = { ...this.paceProfile.behavior, ...paceRaw.behavior };
            }
        },

        async init() {
            try {
                if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime?.id) return;
                const result = await chrome.storage.local.get(['hse_settings', 'hse_custom_settings', 'hse_pace_profile']);
                this.hydrateFromStorage(result.hse_settings, result.hse_custom_settings, result.hse_pace_profile);

                if (chrome.storage.onChanged) {
                    chrome.storage.onChanged.addListener((changes, areaName) => {
                        if (areaName !== 'local') return;
                        if (changes.hse_settings || changes.hse_custom_settings || changes.hse_pace_profile) {
                            const newSettings = changes.hse_settings ? changes.hse_settings.newValue : this.settings;
                            const newCustom = changes.hse_custom_settings ? changes.hse_custom_settings.newValue : this.customSettings;
                            const newPace = changes.hse_pace_profile ? changes.hse_pace_profile.newValue : this.paceProfile;
                            this.hydrateFromStorage(newSettings, newCustom, newPace);
                            HSE_Engine.syncContentSpeed();
                            HSE_UI.renderButtons();
                            HSE_UI.update();
                        }
                    });
                }
            } catch (_) {}
        },

        async save() {
            try {
                if (typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime?.id) return;
                await chrome.storage.local.set({
                    hse_settings: {
                        globalSpeed: this.settings.globalSpeed,
                        showSpeeds: this.settings.showSpeeds,
                        presets: this.settings.presets,
                        speedStep: this.settings.speedStep,
                        defaultFinishTarget: this.settings.defaultFinishTarget,
                        adaptiveEnabled: this.settings.adaptiveEnabled,
                        learnOverrides: this.settings.learnOverrides
                    },
                    hse_pace_profile: this.paceProfile
                });
            } catch (_) {}
        },

        storageKey(showId) {
            return `${Platform.id}:${showId}`;
        },

        getSpeedForShow(showId) {
            const key = this.storageKey(showId);
            if (this.settings.showSpeeds[key] != null) return this.settings.showSpeeds[key];
            if (Platform.id === 'hotstar' && this.settings.showSpeeds[showId] != null) return this.settings.showSpeeds[showId];
            return this.settings.globalSpeed;
        },

        setSpeedForShow(showId, speed) {
            this.settings.showSpeeds[this.storageKey(showId)] = sanitizeSpeed(speed);
            this.save();
        },

        recordSpeedSample(speed, platformId, wasManualOverride = false) {
            if (!this.settings.learnOverrides) return;
            const s = sanitizeSpeed(speed);
            if (s <= 0) return;

            // Exponential moving average (alpha = 0.2)
            const alpha = 0.2;
            this.paceProfile.globalAverage = Math.round(((1 - alpha) * this.paceProfile.globalAverage + alpha * s) * 100) / 100;
            this.paceProfile.sampleCount++;

            if (!this.paceProfile.platforms[platformId]) {
                this.paceProfile.platforms[platformId] = { averageSpeed: s, sampleCount: 1 };
            } else {
                const p = this.paceProfile.platforms[platformId];
                p.averageSpeed = Math.round(((1 - alpha) * p.averageSpeed + alpha * s) * 100) / 100;
                p.sampleCount++;
            }

            if (wasManualOverride) {
                this.paceProfile.behavior.manualOverrides = (this.paceProfile.behavior.manualOverrides || 0) + 1;
            }
            this.save();
        },

        getPersonalPace(platformId) {
            if (platformId && this.paceProfile.platforms[platformId]) {
                return this.paceProfile.platforms[platformId].averageSpeed || this.paceProfile.globalAverage;
            }
            return this.paceProfile.globalAverage || 1.65;
        },

        getPresets() {
            return (this.settings.presets && this.settings.presets.length) 
                ? this.settings.presets 
                : [1, 1.25, 1.5, 1.75, 2, 2.5];
        },

        getSpeedStep() {
            return this.settings.speedStep || 0.1;
        }
    };

    // --- FEATURE 4, 5, 8, 9, 10: HSE_AdaptiveEngine (Content-Aware Autopilot) ---
    const HSE_AdaptiveEngine = {
        isActive: false,
        targetMinutes: 30,
        totalTargetSec: 1800,
        elapsedWallSec: 0,
        lastWallTickTime: 0,
        startVideoTime: 0,
        initialRemainingVideoSec: 0,
        lastAdjustmentTime: 0,
        currentAdaptiveSpeed: 1.0,
        status: 'on_track', // 'on_track', 'ahead', 'slightly_behind', 'catching_up', 'impossible'
        reason: 'Ready',
        actualWatchTimeSec: 0,
        speedSamples: [],

        MIN_SPEED_CHANGE: 0.05,
        MIN_TIME_BETWEEN_ADJUSTMENTS: 2000,

        start(targetMinutes, isPersonalPaceMode = false) {
            const video = HSE_Intel.getVideo();
            if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
                HSE_UI.flash('Start video playback first');
                return;
            }

            const remainingVideoSec = Math.max(1, video.duration - video.currentTime);
            this.startVideoTime = video.currentTime;
            this.initialRemainingVideoSec = remainingVideoSec;
            this.elapsedWallSec = 0;
            this.lastWallTickTime = Date.now();
            this.speedSamples = [];

            if (isPersonalPaceMode) {
                const pace = HSE_Store.getPersonalPace(Platform.id);
                this.targetMinutes = Math.max(1, Math.round((remainingVideoSec / pace) / 60));
            } else {
                this.targetMinutes = Math.max(1, Number(targetMinutes) || HSE_Store.settings.defaultFinishTarget || 30);
            }

            this.totalTargetSec = this.targetMinutes * 60;
            this.isActive = true;
            this.lastAdjustmentTime = 0;

            // Initial calculation & speed application
            this.tick();
            HSE_UI.flash(`⚡ Smart Pace Active: Finish in ${this.targetMinutes}m`, true);
            HSE_UI.update();
        },

        stop(completed = false) {
            if (!this.isActive) return;
            this.isActive = false;

            if (completed) {
                this.showCompletionSummary();
            } else {
                HSE_UI.flash('Smart Pace Stopped');
            }
            HSE_UI.update();
        },

        handlePlay() {
            if (!this.isActive) return;
            this.lastWallTickTime = Date.now();
        },

        handlePause() {
            if (!this.isActive) return;
            // Freeze wall-clock budget when paused
            this.lastWallTickTime = 0;
        },

        handleSeek() {
            if (!this.isActive) return;
            // Immediate recalculation on seek
            this.lastAdjustmentTime = 0;
            this.tick();
        },

        handleEnded() {
            if (!this.isActive) return;
            this.stop(true);
        },

        showCompletionSummary() {
            const video = HSE_Intel.getVideo();
            const origSec = this.initialRemainingVideoSec || (video ? video.duration : 1800);
            const actualSec = Math.max(1, Math.round(this.elapsedWallSec));
            const savedSec = Math.max(0, Math.round(origSec - actualSec));
            const avgSpeed = this.speedSamples.length 
                ? (this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length)
                : HSE_Engine.currentSpeed;

            HSE_UI.showCompletionModal({
                originalDuration: formatTime(origSec),
                actualViewingTime: formatTime(actualSec),
                timeSaved: formatTime(savedSec),
                averagePace: `${avgSpeed.toFixed(2)}x`,
                shareText: `I watched a ${formatTime(origSec)} video in ${formatTime(actualSec)} using OTT SPEED PLAYBACK. Saved ${formatTime(savedSec)}!`
            });
        },

        calculateRequiredSpeed(remainingVideoSec, remainingWallSec) {
            if (remainingWallSec <= 0) return 16.0;
            return remainingVideoSec / remainingWallSec;
        },

        tick() {
            if (!this.isActive) return;
            const video = HSE_Intel.getVideo();
            if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;

            const now = Date.now();

            // 1. Advance wall-clock budget if video is playing
            if (!video.paused && this.lastWallTickTime > 0) {
                const deltaSec = (now - this.lastWallTickTime) / 1000;
                if (deltaSec > 0 && deltaSec < 5) {
                    this.elapsedWallSec += deltaSec;
                    this.speedSamples.push(video.playbackRate);
                }
            }
            this.lastWallTickTime = video.paused ? 0 : now;

            // Check if finished video
            if (video.currentTime >= video.duration - 1) {
                this.stop(true);
                return;
            }

            // 2. Compute remaining budgets
            const remainingVideoSec = Math.max(0, video.duration - video.currentTime);
            const remainingWallSec = Math.max(0.1, this.totalTargetSec - this.elapsedWallSec);
            const requiredSpeed = this.calculateRequiredSpeed(remainingVideoSec, remainingWallSec);

            // 3. Impossible Target Handling (Feature 9)
            if (requiredSpeed > 16.0) {
                this.status = 'impossible';
                const closestSec = remainingVideoSec / 16.0;
                this.reason = `Max pace 16x · Finish: ~${formatTime(closestSec)}`;
                if (Math.abs(HSE_Engine.currentSpeed - 16.0) > 0.05) {
                    HSE_Engine.setSpeed(16.0, false);
                }
                HSE_UI.update();
                return;
            }

            // 4. Content Difficulty Analysis (Feature 1, 2, 3)
            const analysis = HSE_Analyzer.analyze(video);
            const baselinePace = (this.initialRemainingVideoSec / this.totalTargetSec) || 1.5;

            // Determine status
            if (requiredSpeed <= baselinePace * 1.02) {
                this.status = 'ahead';
            } else if (requiredSpeed <= baselinePace * 1.15) {
                this.status = 'on_track';
            } else if (requiredSpeed <= baselinePace * 1.35) {
                this.status = 'slightly_behind';
            } else {
                this.status = 'catching_up';
            }

            // 5. Adaptive Difficulty Modifier Matrix
            let modifier = 1.0;
            switch (analysis.reason) {
                case 'Credits sequence':
                    modifier = 2.4;
                    break;
                case 'Intro / opening':
                    modifier = 1.6;
                    break;
                case 'Very long silence':
                    modifier = 1.85;
                    break;
                case 'Long pause':
                    modifier = 1.45;
                    break;
                case 'Dialogue pause':
                    modifier = 1.25;
                    break;
                case 'Dense dialogue':
                    // In catching_up mode, reduce dialogue slowdown to avoid missing target
                    modifier = (this.status === 'catching_up') ? 0.94 : 0.82;
                    break;
                case 'Normal dialogue':
                    modifier = 0.96;
                    break;
                case 'Simple conversation':
                    modifier = 1.06;
                    break;
                case 'Action / visual sequence':
                    modifier = 1.16;
                    break;
                default:
                    modifier = 1.0;
            }

            // Emergency catch-up modifier if behind schedule
            if (this.status === 'catching_up') {
                modifier = Math.max(modifier, 1.15);
            }

            // 6. Compute Final Adaptive Speed
            let rawTarget = requiredSpeed * modifier;

            // Never fall below 1.0x when user requested finish time
            if (requiredSpeed >= 1.0) {
                rawTarget = Math.max(1.0, rawTarget);
            } else {
                // If target was larger than duration (e.g. Test B: 60m video, 120m target -> required 0.5x),
                // speed should not go below 1.0x as per specification.
                rawTarget = Math.max(1.0, rawTarget);
            }
            rawTarget = Math.min(16.0, rawTarget);

            // 7. Human-Friendly Smoothing & Hysteresis (Feature 5)
            const diff = Math.abs(rawTarget - HSE_Engine.currentSpeed);
            const timeSinceLast = now - this.lastAdjustmentTime;

            if (diff >= this.MIN_SPEED_CHANGE && timeSinceLast >= this.MIN_TIME_BETWEEN_ADJUSTMENTS) {
                // Smooth step: limit instant jump to 0.15x per step
                let stepSpeed = rawTarget;
                if (rawTarget > HSE_Engine.currentSpeed) {
                    stepSpeed = Math.min(rawTarget, HSE_Engine.currentSpeed + 0.15);
                } else {
                    stepSpeed = Math.max(rawTarget, HSE_Engine.currentSpeed - 0.15);
                }
                stepSpeed = Math.round(stepSpeed * 100) / 100;

                HSE_Engine.setSpeed(stepSpeed, false);
                this.lastAdjustmentTime = now;
                this.currentAdaptiveSpeed = stepSpeed;
                this.reason = analysis.reason;
            } else {
                this.reason = analysis.reason;
            }

            HSE_UI.update();
        },

        getProgress() {
            const video = HSE_Intel.getVideo();
            const remainingVideoSec = video && Number.isFinite(video.duration) ? Math.max(0, video.duration - video.currentTime) : 0;
            const remainingWallSec = Math.max(0, this.totalTargetSec - this.elapsedWallSec);
            const req = this.calculateRequiredSpeed(remainingVideoSec, remainingWallSec);

            return {
                isActive: this.isActive,
                targetMinutes: this.targetMinutes,
                remainingVideo: formatTime(remainingVideoSec),
                remainingWall: formatTime(remainingWallSec),
                requiredSpeed: `${Math.min(16, req).toFixed(2)}x`,
                currentSpeed: `${HSE_Engine.currentSpeed.toFixed(2)}x`,
                status: this.status,
                reason: this.reason
            };
        }
    };

    function injectMainWorldScript() {
        if (document.documentElement.dataset.hseMainWorldLoaded === 'true') return;
        try {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('main_world.js');
            script.onload = function () { this.remove(); };
            (document.head || document.documentElement).appendChild(script);
        } catch (_) {}
    }

    // --- HSE_Engine: Action & Playback Rate Control ---
    const HSE_Engine = {
        currentSpeed: 1,
        lastContentId: null,

        setSpeed(speed, isPersistent = true, wasManual = false) {
            const clamped = sanitizeSpeed(speed);
            this.currentSpeed = clamped;
            if (document.documentElement) {
                document.documentElement.dataset.hsePlaybackRate = String(clamped);
            }

            const video = HSE_Intel.getVideo();
            if (video) {
                try {
                    if (Math.abs(video.playbackRate - clamped) > 0.01) {
                        video.playbackRate = clamped;
                    }
                    if (Math.abs(video.defaultPlaybackRate - clamped) > 0.01) {
                        video.defaultPlaybackRate = clamped;
                    }
                } catch (_) {}
            }

            if (isPersistent) {
                const info = HSE_Intel.getContentInfo();
                HSE_Store.setSpeedForShow(info.id, clamped);
                if (wasManual) {
                    HSE_Store.recordSpeedSample(clamped, Platform.id, true);
                    // If Smart Pace is active and user manually sets speed, pause/adjust Smart Pace
                    if (HSE_AdaptiveEngine.isActive) {
                        HSE_UI.flash(`Pace override: ${clamped}x`);
                    } else {
                        HSE_UI.flash(`${clamped}x`);
                    }
                } else {
                    HSE_UI.flash(`${clamped}x`);
                }
                HSE_UI.update();
            }
        },

        syncContentSpeed() {
            if (HSE_AdaptiveEngine.isActive) return;
            const info = HSE_Intel.getContentInfo();
            if (info.id === this.lastContentId) return;
            this.lastContentId = info.id;
            const saved = HSE_Store.getSpeedForShow(info.id);
            this.setSpeed(saved, false);
            HSE_UI.update();
        },

        enforce() {
            if (!HSE_AdaptiveEngine.isActive) {
                this.syncContentSpeed();
            }

            const video = HSE_Intel.getVideo();
            if (!video) return;

            const target = this.currentSpeed;
            if (Math.abs(video.playbackRate - target) > 0.01) {
                try {
                    video.playbackRate = target;
                } catch (_) {}
            }
            HSE_UI.updateStatus();
        }
    };

    // --- FEATURE 7, 8, 12, 14, 15: HSE_UI (Hero Redesign & Feedback) ---
    const HSE_UI = {
        panel: null,
        hideTimer: null,
        flashTimer: null,
        isDragging: false,
        dragOffsetX: 0,
        dragOffsetY: 0,

        init() {
            this.createIndicator();
            window.addEventListener(TOGGLE_EVENT, () => this.toggle());

            document.addEventListener('fullscreenchange', () => {
                const fsTarget = document.fullscreenElement || document.body;
                const ind = document.getElementById('hse-flash-indicator');
                if (ind && ind.parentElement !== fsTarget) fsTarget.appendChild(ind);
                if (this.panel && this.panel.parentElement !== fsTarget) fsTarget.appendChild(this.panel);
            });
        },

        createIndicator() {
            let ind = document.getElementById('hse-flash-indicator');
            if (!ind) {
                ind = document.createElement('div');
                ind.id = 'hse-flash-indicator';
                (document.fullscreenElement || document.body).appendChild(ind);
            }
        },

        flash(text, isLong = false) {
            this.createIndicator();
            const ind = document.getElementById('hse-flash-indicator');
            if (!ind) return;
            ind.textContent = text;
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

            const info = HSE_Intel.getContentInfo();
            const panel = document.createElement('div');
            panel.id = 'hs-speed-panel';
            panel.className = 'mode-vod';

            // --- Header ---
            const header = document.createElement('div');
            header.id = 'hs-speed-header';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'hs-speed-title-wrap';

            const dragIcon = document.createElement('span');
            dragIcon.className = 'hs-speed-drag-handle';
            dragIcon.innerHTML = '&#8942;&#8942;';
            dragIcon.title = 'Drag to reposition';

            const titleEl = document.createElement('span');
            titleEl.id = 'hs-speed-title';
            titleEl.textContent = info.title;

            titleWrap.appendChild(dragIcon);
            titleWrap.appendChild(titleEl);

            const controlsWrap = document.createElement('div');
            controlsWrap.className = 'hse-badges-container';

            const badge = document.createElement('span');
            badge.className = 'hse-badge';
            badge.textContent = Platform.label;

            const settingsBtn = document.createElement('button');
            settingsBtn.className = 'hs-speed-icon-btn';
            settingsBtn.innerHTML = '&#9881;';
            settingsBtn.title = 'Settings';
            settingsBtn.setAttribute('aria-label', 'Open Settings');
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
                        chrome.runtime.sendMessage({ action: 'openOptionsPage' });
                    }
                } catch (_) {}
            });

            const closeBtn = document.createElement('button');
            closeBtn.className = 'hs-speed-icon-btn hs-speed-close-btn';
            closeBtn.innerHTML = '&times;';
            closeBtn.title = 'Close Panel';
            closeBtn.setAttribute('aria-label', 'Close speed overlay');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.remove();
            });

            controlsWrap.appendChild(badge);
            controlsWrap.appendChild(settingsBtn);
            controlsWrap.appendChild(closeBtn);

            header.appendChild(titleWrap);
            header.appendChild(controlsWrap);

            // Dragging
            header.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON' || e.target.classList.contains('hs-speed-icon-btn')) return;
                this.isDragging = true;
                const rect = panel.getBoundingClientRect();
                this.dragOffsetX = e.clientX - rect.left;
                this.dragOffsetY = e.clientY - rect.top;
                panel.classList.add('is-dragging');
                this.resetHideTimer();
            });

            window.addEventListener('mousemove', (e) => {
                if (!this.isDragging || !this.panel) return;
                const x = e.clientX - this.dragOffsetX;
                const y = e.clientY - this.dragOffsetY;
                panel.style.left = `${Math.max(10, Math.min(window.innerWidth - panel.offsetWidth - 10, x))}px`;
                panel.style.top = `${Math.max(10, Math.min(window.innerHeight - panel.offsetHeight - 10, y))}px`;
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                this.resetHideTimer();
            });

            window.addEventListener('mouseup', () => {
                if (this.isDragging && this.panel) {
                    this.isDragging = false;
                    this.panel.classList.remove('is-dragging');
                }
            });

            // --- FEATURE 12: Hero Smart Pace Section ---
            const smartPaceSection = document.createElement('div');
            smartPaceSection.id = 'hs-smart-pace-section';
            smartPaceSection.className = 'hs-smart-pace-card';

            const smartHeader = document.createElement('div');
            smartHeader.className = 'hs-smart-header';
            smartHeader.innerHTML = `
                <div class="hs-smart-title">
                    <span class="hs-lightning">⚡</span>
                    <span>SMART PACE</span>
                </div>
                <button id="hs-use-my-pace-btn" class="hs-pill-btn">Use my pace (${HSE_Store.getPersonalPace(Platform.id).toFixed(2)}x)</button>
            `;

            const promptText = document.createElement('div');
            promptText.className = 'hs-prompt-text';
            promptText.textContent = 'Finish this video in...';

            const chipsContainer = document.createElement('div');
            chipsContainer.className = 'hs-target-chips';
            [20, 30, 45, 60].forEach(min => {
                const chip = document.createElement('button');
                chip.className = 'hs-chip-btn';
                chip.textContent = `${min}m`;
                chip.onclick = () => {
                    document.getElementById('hs-custom-target-input').value = min;
                    HSE_AdaptiveEngine.start(min);
                    this.resetHideTimer();
                };
                chipsContainer.appendChild(chip);
            });

            const inputRow = document.createElement('div');
            inputRow.className = 'hs-input-row';
            inputRow.innerHTML = `
                <div class="hs-target-input-wrap">
                    <input type="number" id="hs-custom-target-input" min="1" max="600" value="${HSE_AdaptiveEngine.targetMinutes || 30}">
                    <span>min</span>
                </div>
                <button id="hs-smart-toggle-btn" class="hs-start-btn">
                    ${HSE_AdaptiveEngine.isActive ? 'STOP' : 'START AUTOPILOT'}
                </button>
            `;

            // Active Telemetry Card (visible when active)
            const telemetryCard = document.createElement('div');
            telemetryCard.id = 'hs-telemetry-card';
            telemetryCard.className = `hs-telemetry-card ${HSE_AdaptiveEngine.isActive ? 'is-active' : ''}`;
            telemetryCard.innerHTML = `
                <div class="hs-telemetry-main">
                    <span id="hs-telemetry-speed" class="hs-telemetry-speed">${HSE_Engine.currentSpeed.toFixed(2)}x</span>
                    <span id="hs-telemetry-reason" class="hs-telemetry-reason">${HSE_AdaptiveEngine.reason || 'Adapting'}</span>
                </div>
                <div class="hs-telemetry-details">
                    <span id="hs-telemetry-remaining">Remaining: ${HSE_AdaptiveEngine.getProgress().remainingWall}</span>
                    <span id="hs-telemetry-status" class="hs-status-tag ${HSE_AdaptiveEngine.status}">${HSE_AdaptiveEngine.status.replace('_', ' ').toUpperCase()}</span>
                </div>
            `;

            smartPaceSection.appendChild(smartHeader);
            smartPaceSection.appendChild(promptText);
            smartPaceSection.appendChild(chipsContainer);
            smartPaceSection.appendChild(inputRow);
            smartPaceSection.appendChild(telemetryCard);

            // Wire buttons
            smartHeader.querySelector('#hs-use-my-pace-btn').onclick = () => {
                HSE_AdaptiveEngine.start(null, true);
                this.resetHideTimer();
            };

            inputRow.querySelector('#hs-smart-toggle-btn').onclick = (e) => {
                if (HSE_AdaptiveEngine.isActive) {
                    HSE_AdaptiveEngine.stop(false);
                    e.target.textContent = 'START AUTOPILOT';
                    e.target.classList.remove('is-stopping');
                } else {
                    const min = parseInt(document.getElementById('hs-custom-target-input').value, 10) || 30;
                    HSE_AdaptiveEngine.start(min);
                    e.target.textContent = 'STOP';
                    e.target.classList.add('is-stopping');
                }
                this.resetHideTimer();
            };

            // --- Manual Controls & Steppers ---
            const manualDivider = document.createElement('div');
            manualDivider.className = 'hs-manual-divider';
            manualDivider.textContent = 'Manual Speed Override';

            const statusRow = document.createElement('div');
            statusRow.className = 'hs-speed-status-row';

            const status = document.createElement('div');
            status.id = 'hs-speed-status';
            status.textContent = `Pace: ${HSE_Engine.currentSpeed}x`;

            const steppers = document.createElement('div');
            steppers.className = 'hs-speed-steppers';
            const stepVal = HSE_Store.getSpeedStep();

            const minusBtn = document.createElement('button');
            minusBtn.className = 'hs-speed-mini-btn';
            minusBtn.textContent = `-${stepVal}x`;
            minusBtn.onclick = () => {
                HSE_Engine.setSpeed(Math.max(MIN_SPEED, +(HSE_Engine.currentSpeed - stepVal).toFixed(2)), true, true);
                this.resetHideTimer();
            };

            const resetBtn = document.createElement('button');
            resetBtn.className = 'hs-speed-mini-btn hs-speed-reset-btn';
            resetBtn.textContent = '1.0x';
            resetBtn.onclick = () => {
                HSE_Engine.setSpeed(1.0, true, true);
                this.resetHideTimer();
            };

            const plusBtn = document.createElement('button');
            plusBtn.className = 'hs-speed-mini-btn';
            plusBtn.textContent = `+${stepVal}x`;
            plusBtn.onclick = () => {
                HSE_Engine.setSpeed(Math.min(MAX_SPEED, +(HSE_Engine.currentSpeed + stepVal).toFixed(2)), true, true);
                this.resetHideTimer();
            };

            steppers.appendChild(minusBtn);
            steppers.appendChild(resetBtn);
            steppers.appendChild(plusBtn);

            statusRow.appendChild(status);
            statusRow.appendChild(steppers);

            const btnContainer = document.createElement('div');
            btnContainer.id = 'hs-speed-btn-container';
            btnContainer.className = 'hs-speed-btn-container';

            panel.appendChild(header);
            panel.appendChild(smartPaceSection);
            panel.appendChild(manualDivider);
            panel.appendChild(statusRow);
            panel.appendChild(btnContainer);

            panel.addEventListener('mouseenter', () => { if (this.hideTimer) clearTimeout(this.hideTimer); });
            panel.addEventListener('mouseleave', () => { this.resetHideTimer(); });

            const mountPoint = document.fullscreenElement || document.body;
            mountPoint.appendChild(panel);
            this.panel = panel;

            this.renderButtons();
            this.resetHideTimer();
        },

        renderButtons() {
            if (!this.panel) return;
            const container = this.panel.querySelector('#hs-speed-btn-container');
            if (!container) return;
            container.innerHTML = '';

            const presets = HSE_Store.getPresets();
            presets.forEach((s) => {
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
                container.appendChild(btn);
            });
        },

        update() {
            if (!this.panel) return;
            const speed = HSE_Engine.currentSpeed;
            this.panel.querySelectorAll('.hs-speed-btn').forEach((btn) => {
                btn.classList.toggle('is-active', Math.abs(parseFloat(btn.dataset.speed) - speed) < 0.01);
            });
            const titleEl = this.panel.querySelector('#hs-speed-title');
            if (titleEl) titleEl.textContent = HSE_Intel.getContentInfo().title;

            const toggleBtn = this.panel.querySelector('#hs-smart-toggle-btn');
            if (toggleBtn) {
                toggleBtn.textContent = HSE_AdaptiveEngine.isActive ? 'STOP' : 'START AUTOPILOT';
                toggleBtn.classList.toggle('is-stopping', HSE_AdaptiveEngine.isActive);
            }

            const telemetry = this.panel.querySelector('#hs-telemetry-card');
            if (telemetry) {
                telemetry.classList.toggle('is-active', HSE_AdaptiveEngine.isActive);
                if (HSE_AdaptiveEngine.isActive) {
                    const prog = HSE_AdaptiveEngine.getProgress();
                    const spEl = telemetry.querySelector('#hs-telemetry-speed');
                    const reEl = telemetry.querySelector('#hs-telemetry-reason');
                    const remEl = telemetry.querySelector('#hs-telemetry-remaining');
                    const stEl = telemetry.querySelector('#hs-telemetry-status');
                    if (spEl) spEl.textContent = `${speed.toFixed(2)}x`;
                    if (reEl) reEl.textContent = prog.reason;
                    if (remEl) remEl.textContent = `${prog.remainingWall} left (Req: ${prog.requiredSpeed})`;
                    if (stEl) {
                        stEl.textContent = prog.status.replace('_', ' ').toUpperCase();
                        stEl.className = `hs-status-tag ${prog.status}`;
                    }
                }
            }
            this.updateStatus();
        },

        updateStatus(text) {
            const status = this.panel ? this.panel.querySelector('#hs-speed-status') : null;
            if (status) {
                status.textContent = text || `Speed: ${HSE_Engine.currentSpeed.toFixed(2)}x`;
            }
        },

        showCompletionModal(data) {
            const existing = document.getElementById('hs-completion-modal');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.id = 'hs-completion-modal';
            modal.className = 'hs-completion-modal';
            modal.innerHTML = `
                <div class="hs-completion-card">
                    <div class="hs-completion-header">
                        <span class="hs-lightning">⚡</span>
                        <h3>Smart Pace Complete</h3>
                        <button class="hs-completion-close">&times;</button>
                    </div>
                    <div class="hs-completion-stats">
                        <div class="hs-stat-item"><span>Original:</span> <strong>${data.originalDuration}</strong></div>
                        <div class="hs-stat-item"><span>You Watched:</span> <strong>${data.actualViewingTime}</strong></div>
                        <div class="hs-stat-item highlight"><span>Time Saved:</span> <strong>${data.timeSaved}</strong></div>
                        <div class="hs-stat-item"><span>Average Pace:</span> <strong>${data.averagePace}</strong></div>
                    </div>
                    <button id="hs-copy-result-btn" class="hs-copy-btn">Copy Result</button>
                    <div id="hs-copy-status" class="hs-copy-status"></div>
                </div>
            `;

            modal.querySelector('.hs-completion-close').onclick = () => modal.remove();
            const copyBtn = modal.querySelector('#hs-copy-result-btn');
            const statusDiv = modal.querySelector('#hs-copy-status');

            copyBtn.onclick = () => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(data.shareText).then(() => {
                        statusDiv.textContent = 'Copied to clipboard!';
                        setTimeout(() => modal.remove(), 2000);
                    }).catch(() => {
                        statusDiv.textContent = data.shareText;
                    });
                } else {
                    statusDiv.textContent = data.shareText;
                }
            };

            const mount = document.fullscreenElement || document.body;
            mount.appendChild(modal);
        },

        resetHideTimer() {
            if (this.hideTimer) clearTimeout(this.hideTimer);
            this.hideTimer = setTimeout(() => {
                if (this.panel && !this.isDragging) {
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

    // --- HSE_Input: Keyboard Listener ---
    const HSE_Input = {
        isSmartSpeedActive: false,
        preSmartSpeed: 1,

        formatKey(e) {
            if (e.key === ' ') return 'Space';
            return e.key;
        },

        isInputElement(el) {
            if (!el) return false;
            const tag = el.tagName ? el.tagName.toUpperCase() : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
            if (el.isContentEditable) return true;
            if (el.getAttribute) {
                if (el.getAttribute('contenteditable') === 'true') return true;
                if (el.getAttribute('role') === 'textbox') return true;
            }
            return false;
        },

        init() {
            window.addEventListener('blur', () => {
                if (this.isSmartSpeedActive) {
                    this.isSmartSpeedActive = false;
                    HSE_Engine.setSpeed(this.preSmartSpeed, false);
                    HSE_UI.flash(`${this.preSmartSpeed}x`);
                }
            });

            window.addEventListener('keydown', (e) => {
                const target = e.composedPath ? e.composedPath()[0] : e.target;
                if (this.isInputElement(target)) return;

                const keyName = this.formatKey(e);
                const custom = HSE_Store.customSettings;

                if (keyName === custom.keySmartSpeed && !this.isSmartSpeedActive && !e.repeat) {
                    this.isSmartSpeedActive = true;
                    this.preSmartSpeed = HSE_Engine.currentSpeed;
                    HSE_Engine.setSpeed(custom.smartSpeedValue, false);
                    HSE_UI.flash(`Fast Forward ${custom.smartSpeedValue}x`, true);
                    return;
                }

                const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
                if (!hasModifier) {
                    const step = HSE_Store.getSpeedStep();
                    if (keyName === custom.keySpeedDown) {
                        e.preventDefault();
                        HSE_Engine.setSpeed(Math.max(MIN_SPEED, +(HSE_Engine.currentSpeed - step).toFixed(2)), true, true);
                    } else if (keyName === custom.keySpeedUp) {
                        e.preventDefault();
                        HSE_Engine.setSpeed(Math.min(MAX_SPEED, +(HSE_Engine.currentSpeed + step).toFixed(2)), true, true);
                    } else if (keyName === custom.keyReset) {
                        e.preventDefault();
                        HSE_Engine.setSpeed(1.0, true, true);
                    }
                }

                if (!e.ctrlKey && !e.metaKey) {
                    if (keyName === custom.keySkipForward) {
                        const video = HSE_Intel.getVideo();
                        if (video && Number.isFinite(video.currentTime)) {
                            video.currentTime += 10;
                            HSE_UI.flash('+10s');
                        }
                    } else if (keyName === custom.keySkipBack) {
                        const video = HSE_Intel.getVideo();
                        if (video && Number.isFinite(video.currentTime)) {
                            video.currentTime = Math.max(0, video.currentTime - 10);
                            HSE_UI.flash('-10s');
                        }
                    }
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

    // --- Message Passing for Toolbar Popup & Background ---
    function setupMessaging() {
        if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;

        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!message || typeof message !== 'object') return;

            if (message.action === 'toggleOverlay') {
                HSE_UI.toggle();
                sendResponse({ success: true });
                return;
            }

            if (message.action === 'getPlaybackState') {
                const info = HSE_Intel.getContentInfo();
                const video = HSE_Intel.getVideo();
                const prog = HSE_AdaptiveEngine.getProgress();

                sendResponse({
                    supported: true,
                    platform: Platform.id,
                    platformLabel: Platform.label,
                    title: info.title,
                    currentSpeed: HSE_Engine.currentSpeed,
                    presets: HSE_Store.getPresets(),
                    speedStep: HSE_Store.getSpeedStep(),
                    personalPace: HSE_Store.getPersonalPace(Platform.id),
                    isVideoPlaying: video ? !video.paused : false,
                    hasVideo: !!video,
                    smartPace: prog
                });
                return;
            }

            if (message.action === 'startSmartPace') {
                const min = message.minutes;
                const isPersonal = !!message.usePersonalPace;
                HSE_AdaptiveEngine.start(min, isPersonal);
                sendResponse({ success: true, progress: HSE_AdaptiveEngine.getProgress() });
                return;
            }

            if (message.action === 'stopSmartPace') {
                HSE_AdaptiveEngine.stop(false);
                sendResponse({ success: true });
                return;
            }

            if (message.action === 'setSpeed') {
                if (typeof message.speed === 'number') {
                    HSE_Engine.setSpeed(message.speed, true, true);
                    sendResponse({ success: true, newSpeed: HSE_Engine.currentSpeed });
                }
                return;
            }

            if (message.action === 'skip') {
                const video = HSE_Intel.getVideo();
                const sec = Number(message.seconds) || 10;
                if (video && Number.isFinite(video.currentTime)) {
                    video.currentTime = Math.max(0, video.currentTime + sec);
                    HSE_UI.flash(sec > 0 ? `+${sec}s` : `${sec}s`);
                    sendResponse({ success: true, currentTime: video.currentTime });
                } else {
                    sendResponse({ success: false });
                }
                return;
            }
        });
    }

    // --- INITIALIZATION ---
    async function init() {
        injectMainWorldScript();
        await HSE_Store.init();
        HSE_Analyzer.init();
        HSE_UI.init();
        HSE_Input.init();
        setupMessaging();

        // 1-second adaptive engine & enforcement heartbeat
        const loopInterval = setInterval(() => {
            if (typeof chrome !== 'undefined' && !chrome.runtime?.id) {
                clearInterval(loopInterval);
                return;
            }
            if (HSE_AdaptiveEngine.isActive) {
                HSE_AdaptiveEngine.tick();
            }
            HSE_Engine.enforce();
        }, REFRESH_MS);

        const loadInitialSpeed = () => {
            HSE_Engine.lastContentId = null;
            HSE_Engine.syncContentSpeed();
        };

        window.addEventListener('popstate', loadInitialSpeed);
        const originalPush = history.pushState;
        if (originalPush) {
            history.pushState = function () {
                originalPush.apply(this, arguments);
                setTimeout(loadInitialSpeed, 400);
            };
        }
        const originalReplace = history.replaceState;
        if (originalReplace) {
            history.replaceState = function () {
                originalReplace.apply(this, arguments);
                setTimeout(loadInitialSpeed, 400);
            };
        }

        loadInitialSpeed();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
