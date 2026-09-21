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

    // --- 1. Intercept Frame Drop & Quality Metrics ---
    // Web players monitor video.getVideoPlaybackQuality().droppedVideoFrames.
    // When speed > 1, frame rendering rate spikes. Players mistake this for hardware struggle
    // and lower video resolution. Neutralizing dropped frame count prevents this downgrade.
    // NOTE: Avoid Reflect.get(target, prop, receiver) because native WebIDL getters throw
    // TypeError: Illegal invocation when invoked on a Proxy receiver.
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
        if (desc && desc.get) {
            Object.defineProperty(HTMLVideoElement.prototype, 'webkitDroppedFrameCount', {
                get() {
                    try {
                        if (getActiveSpeed() > 1.05) return 0;
                        return desc.get.call(this);
                    } catch (_) {
                        return 0;
                    }
                },
                configurable: true,
                enumerable: true
            });
        }
    } catch (_) {}

    // --- 2. Hardware-Level PlaybackRate Interception & Speed Enforcement ---
    // Protects playback rate from being forcefully reset by OTT player scripts (e.g. Hotstar/Shaka ratechange handlers)
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
                } catch (_) {}
            }
        }
    }

    // Capture-phase event listeners to prevent player scripts resetting rate on play/ratechange
    window.addEventListener('play', (e) => {
        if (e.target && e.target.tagName === 'VIDEO') {
            const speed = getActiveSpeed();
            if (speed && Math.abs(speed - 1.0) > 0.01) {
                try {
                    if (origSet) origSet.call(e.target, speed);
                    else e.target.playbackRate = speed;
                } catch (_) {}
            }
        }
    }, true);

    window.addEventListener('ratechange', (e) => {
        if (e.target && e.target.tagName === 'VIDEO') {
            const speed = getActiveSpeed();
            if (speed && Math.abs(speed - 1.0) > 0.01 && Math.abs(e.target.playbackRate - speed) > 0.01) {
                try {
                    if (origSet) origSet.call(e.target, speed);
                    else e.target.playbackRate = speed;
                } catch (_) {}
            }
        }
    }, true);

    // --- 3. HLS.js ABR & Quality Preservation ---
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

    // --- 4. Shaka Player ABR & Quality Preservation ---
    function hookShaka(shakaObj) {
        if (!shakaObj || !shakaObj.Player || shakaObj.Player.__hse_hooked__) return;
        shakaObj.Player.__hse_hooked__ = true;

        const origConfigure = shakaObj.Player.prototype.configure;
        if (origConfigure) {
            shakaObj.Player.prototype.configure = function (config, value) {
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
                            const mult = Math.min(speed, 2.0);
                            config.streaming.bufferingGoal = Math.max(10, Math.round(config.streaming._hse_base_bufferingGoal * mult));
                            config.streaming.rebufferingGoal = Math.max(2, config.streaming.rebufferingGoal || 2);
                        }
                    } catch (_) {}
                }
                return origConfigure.apply(this, arguments);
            };
        }
    }

    try {
        if (window.shaka) {
            hookShaka(window.shaka);
        } else {
            let shakaVal = window.shaka;
            Object.defineProperty(window, 'shaka', {
                get() { return shakaVal; },
                set(val) {
                    shakaVal = val;
                    if (val) hookShaka(val);
                },
                configurable: true,
                enumerable: true
            });
        }
    } catch (_) {}

    // --- 5. Dash.js ABR & Quality Preservation ---
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

    // --- 6. DOM Attribute Observer for Instant Speed Synchronization ---
    const speedAttrObserver = new MutationObserver(() => {
        const speed = getActiveSpeed();
        applySpeedToAllVideos(speed);
    });

    if (document.documentElement) {
        speedAttrObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-hse-playback-rate']
        });
    }
})();
