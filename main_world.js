/**
 * OTT SPEED PLAYBACK - Main World Engine (v4.1.0)
 * Runs in the page context (MAIN world) at document_start.
 * Enforces playback rate on streaming services (Hotstar, Netflix, Prime Video, etc.)
 * and preserves video quality/resolution during speed changes by neutralizing
 * Adaptive Bitrate (ABR) quality downgrades, buffer-drain triggers, and frame-drop penalties.
 */
(function () {
    'use strict';

    const FLAG = '__hse_main_world_loaded__';
    if (window[FLAG]) return;
    window[FLAG] = true;

    if (document.documentElement) {
        document.documentElement.dataset.hseMainWorldLoaded = 'true';
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

    // --- Active Speed State Helper ---
    function getActiveSpeed() {
        const raw = document.documentElement?.dataset?.hsePlaybackRate;
        const datasetSpeed = parseFloat(raw);
        if (Number.isFinite(datasetSpeed) && datasetSpeed >= 0.1 && datasetSpeed <= 16) {
            return datasetSpeed;
        }
        return 1.0;
    }

    // --- 1. Intercept Frame Drop & Quality Metrics (Neutralize ABR Downgrade Signals) ---
    // Web players monitor video.getVideoPlaybackQuality().droppedVideoFrames and webkitDroppedFrameCount.
    // When speed > 1, frame rendering rate spikes. Players mistake this for hardware struggle
    // and lower video resolution to 360p/480p. Neutralizing dropped frame count prevents this downgrade.
    try {
        if (typeof VideoPlaybackQuality !== 'undefined' && VideoPlaybackQuality.prototype) {
            Object.defineProperty(VideoPlaybackQuality.prototype, 'droppedVideoFrames', {
                get() { return 0; },
                configurable: true,
                enumerable: true
            });
            Object.defineProperty(VideoPlaybackQuality.prototype, 'corruptedVideoFrames', {
                get() { return 0; },
                configurable: true,
                enumerable: true
            });
        }
    } catch (_) {}

    const qualityProxyHandler = {
        get(target, prop) {
            if (prop === 'droppedVideoFrames' || prop === 'corruptedVideoFrames') {
                return 0;
            }
            try {
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
            } catch (_) {
                return 0;
            }
        }
    };

    const origGetQuality = HTMLVideoElement.prototype.getVideoPlaybackQuality;
    if (typeof origGetQuality === 'function') {
        HTMLVideoElement.prototype.getVideoPlaybackQuality = function () {
            try {
                const quality = origGetQuality.call(this);
                if (!quality) return quality;
                const speed = getActiveSpeed();
                if (speed > 1.05) {
                    try {
                        Object.defineProperty(quality, 'droppedVideoFrames', { value: 0, configurable: true });
                        Object.defineProperty(quality, 'corruptedVideoFrames', { value: 0, configurable: true });
                    } catch (_) {}
                    return new Proxy(quality, qualityProxyHandler);
                }
                return quality;
            } catch (_) {
                return {
                    creationTime: performance.now(),
                    droppedVideoFrames: 0,
                    totalVideoFrames: 60,
                    corruptedVideoFrames: 0
                };
            }
        };
    }

    // Override webkitDroppedFrameCount getter if defined
    try {
        const desc = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'webkitDroppedFrameCount');
        if (desc && desc.get) {
            Object.defineProperty(HTMLVideoElement.prototype, 'webkitDroppedFrameCount', {
                get() { return 0; },
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

    if (mediaProto) {
        try {
            const desc = Object.getOwnPropertyDescriptor(mediaProto, 'playbackRate');
            if (desc && desc.get && desc.set) {
                origGet = desc.get;
                origSet = desc.set;

                Object.defineProperty(mediaProto, 'playbackRate', {
                    get() {
                        const speed = getActiveSpeed();
                        if (speed && Math.abs(speed - 1.0) > 0.01) {
                            return speed;
                        }
                        return origGet.call(this);
                    },
                    set(val) {
                        const speed = getActiveSpeed();
                        if (speed && Math.abs(speed - 1.0) > 0.01) {
                            // If user has chosen a custom speed, lock native video element to user's speed
                            return origSet.call(this, speed);
                        }
                        return origSet.call(this, val);
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
                        const speed = getActiveSpeed();
                        if (speed && Math.abs(speed - 1.0) > 0.01) {
                            return speed;
                        }
                        return origDefaultGet.call(this);
                    },
                    set(val) {
                        const speed = getActiveSpeed();
                        if (speed && Math.abs(speed - 1.0) > 0.01) {
                            return origDefaultSet.call(this, speed);
                        }
                        return origDefaultSet.call(this, val);
                    },
                    configurable: true,
                    enumerable: true
                });
            }
        } catch (_) {}
    }

    function applySpeedToAllVideos(speed) {
        if (!Number.isFinite(speed) || speed < 0.1 || speed > 16) return;
        const videos = collectAllVideos(document);
        for (const v of videos) {
            if (v && v.isConnected) {
                try {
                    if (origSet) {
                        origSet.call(v, speed);
                    } else {
                        v.playbackRate = speed;
                    }
                    if (origDefaultSet) {
                        origDefaultSet.call(v, speed);
                    } else {
                        v.defaultPlaybackRate = speed;
                    }
                    // Trigger synthetic ratechange if player UI needs notification
                    v.dispatchEvent(new Event('ratechange'));
                } catch (_) {}
            }
        }
    }

    // Capture-phase event listeners to keep rate synchronized during player lifecycle
    const mediaEvents = ['play', 'playing', 'ratechange', 'loadedmetadata', 'canplay'];
    mediaEvents.forEach(evt => {
        window.addEventListener(evt, (e) => {
            if (e.target && e.target.tagName === 'VIDEO') {
                const speed = getActiveSpeed();
                if (speed && Math.abs(speed - 1.0) > 0.01) {
                    try {
                        if (origSet) origSet.call(e.target, speed);
                        else e.target.playbackRate = speed;
                        if (origDefaultSet) origDefaultSet.call(e.target, speed);
                        else e.target.defaultPlaybackRate = speed;
                    } catch (_) {}
                }
            }
        }, true);
    });

    // --- 3. Shaka Player & Hotstar Engine ABR & Quality Preservation ---
    const activeShakaPlayers = new Set();

    function applyShakaSpeedConfig(player, speed) {
        if (!player || typeof player.configure !== 'function') return;
        try {
            if (speed > 1.05) {
                player.configure({
                    abr: {
                        bandwidthDowngradeTarget: 0.001,
                        switchInterval: 999999
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
        // When rate = 1.5x or 2.0x, Shaka falsely thinks the network is inadequate and downshifts to 360p!
        // Forcing rate = 1.0 in playbackRateChanged and chooseByBandwidth neutralizes this penalty!
        if (shakaObj.abr && shakaObj.abr.SimpleAbrManager && shakaObj.abr.SimpleAbrManager.prototype) {
            const abrProto = shakaObj.abr.SimpleAbrManager.prototype;
            const origRateChanged = abrProto.playbackRateChanged;
            if (origRateChanged) {
                abrProto.playbackRateChanged = function (rate) {
                    // Always report 1.0 to ABR bandwidth allocator so video resolution does not downgrade
                    return origRateChanged.call(this, 1.0);
                };
            }

            const origChooseByBandwidth = abrProto.chooseByBandwidth;
            if (origChooseByBandwidth) {
                abrProto.chooseByBandwidth = function (variants, estimatedBandwidth) {
                    this.B = 1.0; // Minified Shaka internal rate variable
                    return origChooseByBandwidth.apply(this, arguments);
                };
            }
        }

        // 3b. Hook Player.prototype
        if (shakaObj.Player && shakaObj.Player.prototype) {
            const proto = shakaObj.Player.prototype;

            const origConfigure = proto.configure;
            if (origConfigure) {
                proto.configure = function (config, value) {
                    const speed = getActiveSpeed();
                    if (speed > 1.05 && typeof config === 'object' && config !== null) {
                        try {
                            if (config.abr) {
                                config.abr.bandwidthDowngradeTarget = 0.001;
                                config.abr.switchInterval = 999999;
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
                    applyShakaSpeedConfig(this, getActiveSpeed());
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
                    if (track && track.height && track.height >= 480) {
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
                            applyShakaSpeedConfig(this.shakaPlayer, getActiveSpeed());
                        }
                    } catch (_) {}
                    return res;
                };
            }

            const origHSConfigure = HSPlayer.prototype.configure;
            if (origHSConfigure) {
                HSPlayer.prototype.configure = function (config) {
                    const speed = getActiveSpeed();
                    if (speed > 1.05 && config && typeof config === 'object') {
                        try {
                            if (config.streaming) {
                                config.streaming.bufferingGoal = Math.max(30, Math.round(20 * Math.min(speed, 3)));
                                config.streaming.rebufferingGoal = 2;
                            }
                            if (config.abr) {
                                config.abr.bandwidthDowngradeTarget = 0.001;
                                config.abr.switchInterval = 999999;
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
                    const speed = getActiveSpeed();
                    if (speed > 1.05 && this.config) {
                        if (this.currentLevel !== -1 && this.currentLevel != null) {
                            this.autoLevelEnabled = false;
                        }
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

    // Fallback MutationObserver on HTML attribute
    const speedAttrObserver = new MutationObserver(() => {
        const speed = getActiveSpeed();
        syncSpeed(speed);
    });

    if (document.documentElement) {
        speedAttrObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-hse-playback-rate']
        });
    }
})();
