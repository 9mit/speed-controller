/**
 * OTT SPEED PLAYBACK - Main World Engine (v2.3.0)
 * Runs in the page context (MAIN world) at document_start.
 * Preserves exact video quality/resolution during speed changes by neutralizing
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
    function findActiveVideo(root = document) {
        if (!root) return null;
        try {
            const vids = root.querySelectorAll ? root.querySelectorAll('video') : [];
            for (let i = 0; i < vids.length; i++) {
                const v = vids[i];
                if (v.isConnected && (!v.paused || v.readyState >= 1)) {
                    return v;
                }
            }
            const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (let i = 0; i < all.length; i++) {
                if (all[i].shadowRoot) {
                    const found = findActiveVideo(all[i].shadowRoot);
                    if (found) return found;
                }
            }
            return vids[0] || null;
        } catch (_) {
            return null;
        }
    }

    // --- Active Speed State Helper ---
    function getActiveSpeed() {
        const datasetSpeed = parseFloat(document.documentElement?.dataset?.hsePlaybackRate);
        if (Number.isFinite(datasetSpeed) && datasetSpeed > 0) {
            return datasetSpeed;
        }
        const video = findActiveVideo();
        if (video && Number.isFinite(video.playbackRate) && video.playbackRate > 0) {
            return video.playbackRate;
        }
        return 1.0;
    }

    // --- 1. Intercept Frame Drop & Quality Metrics ---
    // Web players monitor video.getVideoPlaybackQuality().droppedVideoFrames.
    // When speed > 1, frame rendering rate spikes. Players mistake this for hardware struggle
    // and lower video resolution. Neutralizing dropped frame count prevents this downgrade.
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
            const quality = origGetQuality.call(this);
            if (!quality) return quality;
            const speed = getActiveSpeed();
            if (speed > 1.05) {
                return new Proxy(quality, qualityProxyHandler);
            }
            return quality;
        };
    }

    // Override webkitDroppedFrameCount getter if defined
    try {
        const desc = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'webkitDroppedFrameCount');
        if (desc && desc.get) {
            Object.defineProperty(HTMLVideoElement.prototype, 'webkitDroppedFrameCount', {
                get() {
                    if (getActiveSpeed() > 1.05) return 0;
                    return desc.get.call(this);
                },
                configurable: true,
                enumerable: true
            });
        }
    } catch (_) {}

    // --- 2. HLS.js ABR & Quality Preservation ---
    function hookHLS(HlsClass) {
        if (!HlsClass || HlsClass.__hse_hooked__) return;
        HlsClass.__hse_hooked__ = true;

        const origAttach = HlsClass.prototype.attachMedia;
        if (origAttach) {
            HlsClass.prototype.attachMedia = function (media) {
                try {
                    const speed = getActiveSpeed();
                    if (speed > 1.05 && this.config) {
                        // Prevent auto downgrade if level is chosen
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

    // --- 3. Shaka Player ABR & Quality Preservation ---
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

    // --- 4. Dash.js ABR & Quality Preservation ---
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

    // --- 5. Generic HTMLVideoElement Quality Protection ---
    // Prevent playbackRate updates from desynchronizing.
    const speedAttrObserver = new MutationObserver(() => {
        const speed = getActiveSpeed();
        const video = findActiveVideo();
        if (video && Math.abs(video.playbackRate - speed) > 0.01) {
            try {
                video.playbackRate = speed;
            } catch (_) {}
        }
    });

    if (document.documentElement) {
        speedAttrObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-hse-playback-rate']
        });
    }
})();
