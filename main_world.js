/**
 * OTT SPEED PLAYBACK - Main World Engine (v5.2.0)
 * Runs in the page context (MAIN world) at document_start.
 * Enforces playback rate on streaming services (Hotstar, Netflix, Prime Video, YouTube, etc.)
 * and preserves video quality/resolution during speed changes by neutralizing
 * Adaptive Bitrate (ABR) quality downgrades, buffer-drain triggers, and frame-drop penalties.
 * Includes Smart Live Video Guard: automatically preserves 1.0x normal speed and prevents
 * player buffer exhaustion on live streams across all supported platforms.
 */
(function () {
    'use strict';

    const FLAG = '__hse_main_world_loaded__';
    if (window[FLAG]) return;
    window[FLAG] = true;

    if (document.documentElement) {
        document.documentElement.dataset.hseMainWorldLoaded = 'true';
    }

    // --- User Gesture Tracking (distinguish user speed clicks from automated player resets) ---
    let lastUserGestureTime = 0;
    ['click', 'keydown', 'pointerdown'].forEach(type => {
        window.addEventListener(type, (e) => {
            if (e.isTrusted) lastUserGestureTime = Date.now();
        }, { capture: true, passive: true });
    });

    function isRecentUserGesture() {
        return (Date.now() - lastUserGestureTime) < 600;
    }

    // --- Active Video Discovery (including open Shadow DOM) ---
    function collectAllVideos(root = document, results = []) {
        if (!root) return results;
        try {
            if (root.querySelectorAll) {
                root.querySelectorAll('video').forEach(v => results.push(v));
                root.querySelectorAll('*').forEach(el => {
                    if (el.shadowRoot) collectAllVideos(el.shadowRoot, results);
                });
            }
        } catch (_) {}
        return results;
    }

    function findActiveVideo(root = document) {
        const vids = collectAllVideos(root);
        if (!vids.length) return null;
        const playing = vids.find(v => v.isConnected && !v.paused && v.readyState >= 1);
        if (playing) return playing;
        const connected = vids.filter(v => v.isConnected);
        if (!connected.length) return vids[0] || null;
        return connected.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || connected[0];
    }

    // --- Smart Live Video Detection ---
    function isVideoLive(video) {
        if (!video) return false;
        try {
            // 1. Explicit live marker set by content script
            if (document.documentElement?.dataset?.hseIsLive === 'true') return true;

            // 2. Standard HTML5 Media duration check (Spec: ongoing live streams return positive Infinity)
            if (video.duration === Infinity) return true;

            // 3. Ready state >= 1 with non-finite duration
            if (!Number.isFinite(video.duration) && video.readyState >= 1) return true;

            // 4. Attached Shaka player instance live check
            if (video.__hse_shaka_player__ && typeof video.__hse_shaka_player__.isLive === 'function') {
                if (video.__hse_shaka_player__.isLive()) return true;
            }

            // 5. Active Shaka players in page
            for (const p of activeShakaPlayers) {
                try {
                    if (typeof p.getMediaElement === 'function' && p.getMediaElement() === video) {
                        if (typeof p.isLive === 'function' && p.isLive()) return true;
                    }
                } catch (_) {}
            }

            // 6. YouTube Live detection (DOM & Player API)
            const ytPlayer = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            if (ytPlayer) {
                if (typeof ytPlayer.getVideoData === 'function') {
                    const data = ytPlayer.getVideoData();
                    if (data && (data.isLive === true || data.isLiveStream === true)) return true;
                }
                if (typeof ytPlayer.isLive === 'function' && ytPlayer.isLive()) return true;
                if (ytPlayer.classList && ytPlayer.classList.contains('ytp-live')) return true;
            }

            // 7. Generic / Platform DOM Live Badges in player containers
            const container = video.closest(
                '.html5-video-player, [data-testid="player-container"], .player-container, ' +
                '.shaka-video-container, .video-container, [data-testid="video-player"], body'
            );
            if (container) {
                if (container.querySelector(
                    '.ytp-live-badge, [data-testid="live-tag"], .live-tag, .live-badge, ' +
                    '.atvwebplayersdk-live-badge, .badge-style-type-live-now, [data-testid*="live-indicator"]'
                )) {
                    return true;
                }
            }

            // 8. URL check for live endpoints
            const path = window.location.pathname || '';
            const search = window.location.search || '';
            if (/\/live(\/|$|\?)/i.test(path) ||
                /\/sports\/.*\/live\b/i.test(path) ||
                /\/live-(tv|channels)\b/i.test(path) ||
                search.includes('live=1')) {
                return true;
            }
        } catch (_) {}
        return false;
    }

    // --- Active Speed State Helper ---
    function getActiveSpeed(video) {
        if (video && isVideoLive(video)) {
            return 1.0;
        }
        if (document.documentElement?.dataset?.hseIsLive === 'true') {
            return 1.0;
        }
        const raw = document.documentElement?.dataset?.hsePlaybackRate;
        const datasetSpeed = parseFloat(raw);
        if (Number.isFinite(datasetSpeed) && datasetSpeed >= 0.25 && datasetSpeed <= 16) {
            return datasetSpeed;
        }
        return 1.0;
    }

    // --- 1. Intercept Frame Drop & Quality Metrics (Neutralize ABR Downgrade Signals) ---
    // Web players monitor video.getVideoPlaybackQuality().droppedVideoFrames and webkitDroppedFrameCount.
    // When speed > 1 on VOD, frame rendering rate spikes. Neutralizing dropped frame count prevents downgrade.
    // On live streams, metrics remain untouched to preserve native live player heuristics.
    try {
        if (typeof VideoPlaybackQuality !== 'undefined' && VideoPlaybackQuality.prototype) {
            const descDropped = Object.getOwnPropertyDescriptor(VideoPlaybackQuality.prototype, 'droppedVideoFrames');
            if (descDropped && descDropped.configurable) {
                Object.defineProperty(VideoPlaybackQuality.prototype, 'droppedVideoFrames', {
                    get() {
                        const speed = getActiveSpeed();
                        if (speed > 1.05 && document.documentElement?.dataset?.hseIsLive !== 'true') return 0;
                        return descDropped.get ? descDropped.get.call(this) : 0;
                    },
                    configurable: true,
                    enumerable: true
                });
            }
            const descCorrupted = Object.getOwnPropertyDescriptor(VideoPlaybackQuality.prototype, 'corruptedVideoFrames');
            if (descCorrupted && descCorrupted.configurable) {
                Object.defineProperty(VideoPlaybackQuality.prototype, 'corruptedVideoFrames', {
                    get() {
                        const speed = getActiveSpeed();
                        if (speed > 1.05 && document.documentElement?.dataset?.hseIsLive !== 'true') return 0;
                        return descCorrupted.get ? descCorrupted.get.call(this) : 0;
                    },
                    configurable: true,
                    enumerable: true
                });
            }
        }
    } catch (_) {}

    const qualityProxyHandler = {
        get(target, prop, receiver) {
            if (prop === 'droppedVideoFrames' || prop === 'corruptedVideoFrames') {
                return 0;
            }
            const val = Reflect.get(target, prop, receiver);
            return typeof val === 'function' ? val.bind(target) : val;
        }
    };

    const origGetQuality = HTMLVideoElement.prototype.getVideoPlaybackQuality;
    if (typeof origGetQuality === 'function') {
        HTMLVideoElement.prototype.getVideoPlaybackQuality = function () {
            try {
                const quality = origGetQuality.call(this);
                if (!quality) return quality;
                if (isVideoLive(this)) return quality;
                const speed = getActiveSpeed(this);
                if (speed > 1.05) {
                    return new Proxy(quality, qualityProxyHandler);
                }
                return quality;
            } catch (_) {
                return origGetQuality.call(this);
            }
        };
    }

    // Override webkitDroppedFrameCount getter if defined
    try {
        const desc = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'webkitDroppedFrameCount');
        if (desc && desc.get && desc.configurable) {
            Object.defineProperty(HTMLVideoElement.prototype, 'webkitDroppedFrameCount', {
                get() {
                    const speed = getActiveSpeed(this);
                    if (speed > 1.05 && !isVideoLive(this)) return 0;
                    return desc.get ? desc.get.call(this) : 0;
                },
                configurable: true,
                enumerable: true
            });
        }
    } catch (_) {}

    // --- 2. Hardware-Level PlaybackRate Interception & Speed Enforcement ---
    const mediaProto = (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype)
        ? HTMLMediaElement.prototype
        : (typeof HTMLVideoElement !== 'undefined' ? HTMLVideoElement.prototype : null);

    let origGet = null;
    let origSet = null;
    let origDefaultGet = null;
    let origDefaultSet = null;
    let isApplyingSpeed = false;

    if (mediaProto) {
        try {
            const desc = Object.getOwnPropertyDescriptor(mediaProto, 'playbackRate');
            if (desc && desc.get && desc.set) {
                origGet = desc.get;
                origSet = desc.set;

                Object.defineProperty(mediaProto, 'playbackRate', {
                    get() {
                        return origGet.call(this);
                    },
                    set(val) {
                        const n = Number(val);
                        if (!Number.isFinite(n) || n <= 0) {
                            return origSet.call(this, val);
                        }

                        // --- LIVE STREAM PROTECTION ---
                        if (isVideoLive(this)) {
                            // Live videos must remain at 1.0x normal speed to prevent buffer drain and playback failure
                            if (isApplyingSpeed) {
                                return origSet.call(this, 1.0);
                            }
                            // Allow native player live-edge micro-adjustments (~0.95 - 1.05)
                            if (Math.abs(n - 1.0) < 0.08) {
                                return origSet.call(this, n);
                            }
                            return origSet.call(this, 1.0);
                        }

                        if (isApplyingSpeed) {
                            return origSet.call(this, n);
                        }

                        const activeSpeed = getActiveSpeed(this);

                        // If set by a background player script without trusted user gesture (e.g. autoplay next episode),
                        // preserve the user's active speed setting instead of letting player reset to 1.0x or 0.1x!
                        if (!isRecentUserGesture() && Math.abs(activeSpeed - 1.0) > 0.01 && Math.abs(n - 1.0) < 0.01) {
                            return origSet.call(this, activeSpeed);
                        }

                        const clamped = Math.min(16, Math.max(0.25, n));
                        const res = origSet.call(this, clamped);

                        try {
                            if (origDefaultSet) {
                                origDefaultSet.call(this, clamped);
                            }
                            if (this.preservesPitch === false) {
                                this.preservesPitch = true;
                            }
                        } catch (_) {}

                        // If this was initiated by a genuine user interaction in the native player UI (e.g. YouTube menu),
                        // sync the chosen rate with the extension
                        if (isRecentUserGesture() && Math.abs(clamped - activeSpeed) > 0.01) {
                            if (document.documentElement) {
                                document.documentElement.dataset.hsePlaybackRate = String(clamped);
                            }
                            for (const p of activeShakaPlayers) {
                                applyShakaSpeedConfig(p, clamped);
                            }
                            window.dispatchEvent(new CustomEvent('hs-platform-speed-change', {
                                detail: { speed: clamped }
                            }));
                        }
                        return res;
                    },
                    configurable: true,
                    enumerable: true
                });
            }

            const defDesc = Object.getOwnPropertyDescriptor(mediaProto, 'defaultPlaybackRate');
            if (defDesc && defDesc.get && defDesc.set) {
                origDefaultGet = defDesc.get;
                origDefaultSet = defDesc.set;

                Object.defineProperty(mediaProto, 'defaultPlaybackRate', {
                    get() {
                        return origDefaultGet ? origDefaultGet.call(this) : (origGet ? origGet.call(this) : 1.0);
                    },
                    set(val) {
                        const n = Number(val);
                        if (!Number.isFinite(n) || n <= 0) {
                            return origDefaultSet ? origDefaultSet.call(this, val) : undefined;
                        }
                        if (isVideoLive(this)) {
                            return origDefaultSet ? origDefaultSet.call(this, 1.0) : undefined;
                        }
                        const clamped = Math.min(16, Math.max(0.25, n));
                        return origDefaultSet ? origDefaultSet.call(this, clamped) : undefined;
                    },
                    configurable: true,
                    enumerable: true
                });
            }
        } catch (_) {}
    }

    function applySpeedToAllVideos(speed) {
        if (!Number.isFinite(speed) || speed < 0.25 || speed > 16) return;
        isApplyingSpeed = true;
        try {
            const videos = collectAllVideos(document);
            for (const v of videos) {
                if (v && v.isConnected) {
                    const targetSpeed = isVideoLive(v) ? 1.0 : speed;
                    try {
                        if (origSet) {
                            origSet.call(v, targetSpeed);
                        } else {
                            v.playbackRate = targetSpeed;
                        }
                        if (origDefaultSet) {
                            origDefaultSet.call(v, targetSpeed);
                        } else {
                            v.defaultPlaybackRate = targetSpeed;
                        }
                        if (v.preservesPitch === false) {
                            v.preservesPitch = true;
                        }
                    } catch (_) {}
                }
            }
        } finally {
            isApplyingSpeed = false;
        }
    }

    // Capture-phase event listeners to keep rate synchronized during player lifecycle (new video loads, next episode, unpause)
    const mediaEvents = ['play', 'playing', 'loadedmetadata', 'canplay'];
    mediaEvents.forEach(evt => {
        window.addEventListener(evt, (e) => {
            if (e.target && e.target.tagName === 'VIDEO') {
                const targetSpeed = isVideoLive(e.target) ? 1.0 : getActiveSpeed(e.target);
                if (Number.isFinite(targetSpeed) && targetSpeed >= 0.25) {
                    try {
                        const current = origGet ? origGet.call(e.target) : e.target.playbackRate;
                        if (Math.abs(current - targetSpeed) > 0.01) {
                            if (origSet) origSet.call(e.target, targetSpeed);
                            else e.target.playbackRate = targetSpeed;
                            if (origDefaultSet) origDefaultSet.call(e.target, targetSpeed);
                            else e.target.defaultPlaybackRate = targetSpeed;
                        }
                        if (e.target.preservesPitch === false) {
                            e.target.preservesPitch = true;
                        }
                    } catch (_) {}
                }
            }
        }, true);
    });

    // Listen for ratechange events: adopt only on user gesture, re-enforce active speed on automatic player resets
    window.addEventListener('ratechange', (e) => {
        if (isApplyingSpeed) return;
        if (e.target && e.target.tagName === 'VIDEO') {
            try {
                if (isVideoLive(e.target)) {
                    // Live stream: keep at 1.0x. If rate strayed above 1.08, restore 1.0x
                    const current = origGet ? origGet.call(e.target) : e.target.playbackRate;
                    if (Number.isFinite(current) && current > 1.08) {
                        if (origSet) origSet.call(e.target, 1.0);
                        else e.target.playbackRate = 1.0;
                    }
                    return;
                }

                const current = origGet ? origGet.call(e.target) : e.target.playbackRate;
                if (!Number.isFinite(current) || current <= 0) return;

                const activeSpeed = getActiveSpeed(e.target);
                if (Math.abs(current - activeSpeed) > 0.01) {
                    if (isRecentUserGesture()) {
                        // User interacted with platform native speed control (e.g. YouTube gear menu)
                        const clamped = Math.min(16, Math.max(0.25, current));
                        if (document.documentElement) {
                            document.documentElement.dataset.hsePlaybackRate = String(clamped);
                        }
                        for (const p of activeShakaPlayers) {
                            applyShakaSpeedConfig(p, clamped);
                        }
                        window.dispatchEvent(new CustomEvent('hs-platform-speed-change', {
                            detail: { speed: clamped }
                        }));
                    } else {
                        // Background player reset (next episode autoplay / buffer reset) - re-enforce user's speed!
                        if (origSet) origSet.call(e.target, activeSpeed);
                        else e.target.playbackRate = activeSpeed;
                        if (origDefaultSet) origDefaultSet.call(e.target, activeSpeed);
                        else e.target.defaultPlaybackRate = activeSpeed;
                    }
                }
            } catch (_) {}
        }
    }, true);

    // --- 3. Shaka Player & Hotstar Engine ABR & Quality Preservation ---
    const activeShakaPlayers = new Set();

    function applyShakaSpeedConfig(player, speed) {
        if (!player || typeof player.configure !== 'function') return;
        try {
            // NEVER alter buffering goals or ABR on live streams!
            if (typeof player.isLive === 'function' && player.isLive()) return;
            const media = (typeof player.getMediaElement === 'function') ? player.getMediaElement() : null;
            if (media && isVideoLive(media)) return;

            if (speed > 1.05) {
                player.configure({
                    abr: {
                        bandwidthDowngradeTarget: 0.85,
                        switchInterval: 4
                    },
                    streaming: {
                        bufferingGoal: Math.max(30, Math.round(20 * Math.min(speed, 3))),
                        rebufferingGoal: 2,
                        bufferBehind: 30
                    }
                });

                // If player has an active variant track with height, protect minimum resolution
                if (typeof player.getVariantTracks === 'function') {
                    const tracks = player.getVariantTracks();
                    const active = tracks.find(t => t.active);
                    if (active && active.height && active.height >= 480) {
                        const targetMin = Math.min(active.height, 720);
                        player.configure({
                            abr: {
                                restrictions: {
                                    minHeight: targetMin
                                }
                            }
                        });
                    }
                }
            } else {
                player.configure({
                    abr: {
                        bandwidthDowngradeTarget: 0.95,
                        switchInterval: 8,
                        restrictions: {
                            minHeight: 0
                        }
                    },
                    streaming: {
                        bufferingGoal: 10,
                        rebufferingGoal: 2
                    }
                });
            }
        } catch (_) {}
    }

    function hookShaka(shakaObj) {
        if (!shakaObj || shakaObj.__hse_hooked__) return;
        shakaObj.__hse_hooked__ = true;

        // 3a. Hook SimpleAbrManager:
        // By default, Shaka multiplies required bitrate by playbackRate in chooseByBandwidth:
        // a = (rate * variant.bandwidth) / bandwidthDowngradeTarget.
        // Forcing rate = 1.0 on VOD neutralizes this penalty without hurting live playback!
        if (shakaObj.abr && shakaObj.abr.SimpleAbrManager && shakaObj.abr.SimpleAbrManager.prototype) {
            const abrProto = shakaObj.abr.SimpleAbrManager.prototype;
            const origRateChanged = abrProto.playbackRateChanged;
            if (origRateChanged) {
                abrProto.playbackRateChanged = function (rate) {
                    if (document.documentElement?.dataset?.hseIsLive === 'true') {
                        return origRateChanged.call(this, rate);
                    }
                    return origRateChanged.call(this, 1.0);
                };
            }
        }

        // 3b. Hook Player.prototype
        if (shakaObj.Player && shakaObj.Player.prototype) {
            const proto = shakaObj.Player.prototype;

            const origConfigure = proto.configure;
            if (origConfigure) {
                proto.configure = function (config, value) {
                    if (typeof this.isLive === 'function' && this.isLive()) {
                        return origConfigure.apply(this, arguments);
                    }
                    const speed = getActiveSpeed();
                    if (speed > 1.05 && typeof config === 'object' && config !== null) {
                        try {
                            if (config.abr) {
                                config.abr.bandwidthDowngradeTarget = 0.85;
                                config.abr.switchInterval = 4;
                            }
                            if (config.streaming) {
                                if (!config.streaming._hse_base_bufferingGoal) {
                                    config.streaming._hse_base_bufferingGoal = config.streaming.bufferingGoal || 10;
                                }
                                const mult = Math.min(speed, 2.5);
                                config.streaming.bufferingGoal = Math.max(30, Math.round(config.streaming._hse_base_bufferingGoal * mult));
                                config.streaming.rebufferingGoal = Math.max(2, config.streaming.rebufferingGoal || 2);
                            }
                        } catch (_) {}
                    }
                    return origConfigure.apply(this, arguments);
                };
            }

            const origAttach = proto.attach;
            if (origAttach) {
                proto.attach = function (mediaElement) {
                    activeShakaPlayers.add(this);
                    if (mediaElement) mediaElement.__hse_shaka_player__ = this;
                    applyShakaSpeedConfig(this, getActiveSpeed(mediaElement));
                    return origAttach.apply(this, arguments);
                };
            }

            const origLoad = proto.load;
            if (origLoad) {
                proto.load = function () {
                    activeShakaPlayers.add(this);
                    applyShakaSpeedConfig(this, getActiveSpeed());
                    return origLoad.apply(this, arguments);
                };
            }

            const origSelectVariantTrack = proto.selectVariantTrack;
            if (origSelectVariantTrack) {
                proto.selectVariantTrack = function (track, clearBuffer) {
                    if (track && track.height && track.height >= 480 && !(typeof this.isLive === 'function' && this.isLive())) {
                        try {
                            this.configure({
                                abr: {
                                    restrictions: {
                                        minHeight: Math.min(track.height, 720)
                                    }
                                }
                            });
                        } catch (_) {}
                    }
                    return origSelectVariantTrack.apply(this, arguments);
                };
            }

            const origDestroy = proto.destroy;
            if (origDestroy) {
                proto.destroy = function () {
                    activeShakaPlayers.delete(this);
                    return origDestroy.apply(this, arguments);
                };
            }
        }
    }

    // --- 4. Hotstar HSPlayer Hooking (Hotstar Web Custom Wrapper) ---
    function hookHSPlayer(HSPlayer) {
        if (!HSPlayer || HSPlayer.__hse_hooked__) return;
        HSPlayer.__hse_hooked__ = true;

        if (HSPlayer.shaka) {
            hookShaka(HSPlayer.shaka);
        }

        if (HSPlayer.prototype) {
            const origInitShaka = HSPlayer.prototype.initializeShaka;
            if (origInitShaka) {
                HSPlayer.prototype.initializeShaka = function () {
                    const res = origInitShaka.apply(this, arguments);
                    try {
                        if (this.shakaPlayer) {
                            activeShakaPlayers.add(this.shakaPlayer);
                            if (this.$videoElement) {
                                this.$videoElement.__hse_shaka_player__ = this.shakaPlayer;
                                this.$videoElement.__hse_hs_player__ = this;
                            }
                            applyShakaSpeedConfig(this.shakaPlayer, getActiveSpeed(this.$videoElement));
                        }
                    } catch (_) {}
                    return res;
                };
            }

            const origHSConfigure = HSPlayer.prototype.configure;
            if (origHSConfigure) {
                HSPlayer.prototype.configure = function (config) {
                    if (this.isLive || (this.shakaPlayer && typeof this.shakaPlayer.isLive === 'function' && this.shakaPlayer.isLive())) {
                        return origHSConfigure.apply(this, arguments);
                    }
                    const speed = getActiveSpeed();
                    if (speed > 1.05 && config && typeof config === 'object') {
                        try {
                            if (config.streaming) {
                                config.streaming.bufferingGoal = Math.max(30, Math.round(20 * Math.min(speed, 3)));
                                config.streaming.rebufferingGoal = 2;
                            }
                            if (config.abr) {
                                config.abr.bandwidthDowngradeTarget = 0.85;
                                config.abr.switchInterval = 4;
                            }
                        } catch (_) {}
                    }
                    return origHSConfigure.apply(this, arguments);
                };
            }
        }
    }

    // Monitor for HSPlayer (Hotstar)
    if (window.HSPlayer) {
        hookHSPlayer(window.HSPlayer);
    } else {
        let hsPlayerVal = window.HSPlayer;
        try {
            Object.defineProperty(window, 'HSPlayer', {
                get() { return hsPlayerVal; },
                set(val) {
                    hsPlayerVal = val;
                    if (val) hookHSPlayer(val);
                },
                configurable: true,
                enumerable: true
            });
        } catch (_) {}
    }

    // Monitor for standard window.shaka
    if (window.shaka) {
        hookShaka(window.shaka);
    } else {
        let shakaVal = window.shaka;
        try {
            Object.defineProperty(window, 'shaka', {
                get() { return shakaVal; },
                set(val) {
                    shakaVal = val;
                    if (val) hookShaka(val);
                },
                configurable: true,
                enumerable: true
            });
        } catch (_) {}
    }

    // --- 5. HLS.js ABR & Quality Preservation ---
    function hookHLS(HlsClass) {
        if (!HlsClass || HlsClass.__hse_hooked__) return;
        HlsClass.__hse_hooked__ = true;

        const origAttach = HlsClass.prototype.attachMedia;
        if (origAttach) {
            HlsClass.prototype.attachMedia = function (media) {
                try {
                    if (media && isVideoLive(media)) {
                        return origAttach.apply(this, arguments);
                    }
                    const speed = getActiveSpeed(media);
                    if (speed > 1.05 && this.config) {
                        if (!this.config._hse_base_maxBufferLength) {
                            this.config._hse_base_maxBufferLength = this.config.maxBufferLength || 30;
                        }
                        if (!this.config._hse_base_maxMaxBufferLength) {
                            this.config._hse_base_maxMaxBufferLength = this.config.maxMaxBufferLength || 600;
                        }
                        this.config.autoLevelCapping = -1;
                        const mult = Math.min(speed, 2.5);
                        this.config.maxBufferLength = Math.max(30, Math.round(this.config._hse_base_maxBufferLength * mult));
                        this.config.maxMaxBufferLength = Math.max(60, Math.round(this.config._hse_base_maxMaxBufferLength * mult));
                    }
                } catch (_) {}
                return origAttach.apply(this, arguments);
            };
        }
    }

    try {
        if (window.Hls) {
            hookHLS(window.Hls);
        } else {
            let hlsVal = window.Hls;
            Object.defineProperty(window, 'Hls', {
                get() { return hlsVal; },
                set(val) {
                    hlsVal = val;
                    if (val) hookHLS(val);
                },
                configurable: true,
                enumerable: true
            });
        }
    } catch (_) {}

    // --- 6. Dash.js ABR & Quality Preservation ---
    function hookDash(dashjsObj) {
        if (!dashjsObj || !dashjsObj.MediaPlayer || dashjsObj.MediaPlayer.__hse_hooked__) return;
        dashjsObj.MediaPlayer.__hse_hooked__ = true;

        const origCreate = dashjsObj.MediaPlayer.create;
        if (origCreate) {
            dashjsObj.MediaPlayer.create = function () {
                const instance = origCreate.apply(this, arguments);
                if (instance && instance.updateSettings) {
                    const origUpdate = instance.updateSettings;
                    instance.updateSettings = function (settings) {
                        if (typeof this.isDynamic === 'function' && this.isDynamic()) {
                            return origUpdate.apply(this, arguments);
                        }
                        const speed = getActiveSpeed();
                        if (speed > 1.05 && settings && settings.streaming && settings.streaming.abr) {
                            try {
                                if (settings.streaming.abr.rules) {
                                    settings.streaming.abr.rules.insufficientBufferRule = { active: false };
                                    settings.streaming.abr.rules.droppedFramesRule = { active: false };
                                }
                            } catch (_) {}
                        }
                        return origUpdate.apply(this, arguments);
                    };
                }
                return instance;
            };
        }
    }

    try {
        if (window.dashjs) {
            hookDash(window.dashjs);
        } else {
            let dashVal = window.dashjs;
            Object.defineProperty(window, 'dashjs', {
                get() { return dashVal; },
                set(val) {
                    dashVal = val;
                    if (val) hookDash(val);
                },
                configurable: true,
                enumerable: true
            });
        }
    } catch (_) {}

    // --- 7. Speed Synchronization (IPC Event & DOM Mutation Observer) ---
    function syncSpeed(speed) {
        applySpeedToAllVideos(speed);
        for (const p of activeShakaPlayers) {
            applyShakaSpeedConfig(p, speed);
        }
    }

    // Direct synchronous IPC event from content script
    window.addEventListener('hs-speed-change', (e) => {
        const speed = e.detail?.speed || getActiveSpeed();
        syncSpeed(speed);
    });

    window.addEventListener('hs-live-status-change', (e) => {
        if (e.detail?.isLive) {
            applySpeedToAllVideos(1.0);
        }
    });

    // Fallback MutationObserver on HTML attribute
    const speedAttrObserver = new MutationObserver(() => {
        const speed = getActiveSpeed();
        syncSpeed(speed);
    });

    if (document.documentElement) {
        speedAttrObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-hse-playback-rate', 'data-hse-is-live']
        });
    }
})();
