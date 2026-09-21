/**
 * OTT SPEED PLAYBACK - Options Page Controller (v4.0.0)
 */

const DEFAULT_SETTINGS = {
    keySpeedUp: ']',
    keySpeedDown: '[',
    keyReset: 'r',
    keySkipForward: 'ArrowRight',
    keySkipBack: 'ArrowLeft',
    keySmartSpeed: 'Shift',
    smartSpeedValue: '2.0',
    speedStep: '0.1',
    speedPresets: '1, 1.25, 1.5, 1.75, 2, 2.5',
    defaultFinishTarget: '30',
    adaptiveEnabled: true,
    learnOverrides: true
};

function formatKey(e) {
    if (e.key === ' ') return 'Space';
    return e.key;
}

document.addEventListener('DOMContentLoaded', () => {
    const inputs = document.querySelectorAll('.hotkey-input');
    const selectSmartSpeed = document.getElementById('smartSpeedValue');
    const selectSpeedStep = document.getElementById('speedStep');
    const inputPresets = document.getElementById('speedPresets');
    const selectFinishTarget = document.getElementById('defaultFinishTarget');
    const checkAdaptive = document.getElementById('adaptiveEnabled');
    const checkLearn = document.getElementById('learnOverrides');
    const personalPaceDisplay = document.getElementById('personalPaceDisplay');
    const resetPaceBtn = document.getElementById('resetPaceBtn');

    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');
    const statusEl = document.getElementById('statusMessage');
    const collisionAlert = document.getElementById('collisionAlert');

    function checkCollisions() {
        const values = new Map();
        let hasCollision = false;

        inputs.forEach(input => {
            const val = input.value.trim();
            if (!val || val === 'Press key...') return;
            if (values.has(val)) {
                hasCollision = true;
                input.classList.add('collision');
                const first = values.get(val);
                first.classList.add('collision');
            } else {
                values.set(val, input);
                input.classList.remove('collision');
            }
        });

        collisionAlert.style.display = hasCollision ? 'block' : 'none';
        return hasCollision;
    }

    // Load existing settings
    chrome.storage.local.get(['hse_settings', 'hse_custom_settings', 'hse_pace_profile'], (result) => {
        const custom = result.hse_custom_settings || {};
        const general = result.hse_settings || {};
        const pace = result.hse_pace_profile || {};

        inputs.forEach(input => {
            const key = input.id;
            input.value = custom[key] || DEFAULT_SETTINGS[key];
        });

        selectSmartSpeed.value = String(custom.smartSpeedValue || DEFAULT_SETTINGS.smartSpeedValue);
        selectSpeedStep.value = String(general.speedStep || DEFAULT_SETTINGS.speedStep);
        selectFinishTarget.value = String(general.defaultFinishTarget || DEFAULT_SETTINGS.defaultFinishTarget);
        checkAdaptive.checked = (general.adaptiveEnabled !== false);
        checkLearn.checked = (general.learnOverrides !== false);

        if (Array.isArray(general.presets) && general.presets.length) {
            inputPresets.value = general.presets.join(', ');
        } else {
            inputPresets.value = DEFAULT_SETTINGS.speedPresets;
        }

        const learned = pace.globalAverage || 1.65;
        personalPaceDisplay.textContent = `${learned.toFixed(2)}x`;

        checkCollisions();
    });

    // Reset Personal Pace
    resetPaceBtn.addEventListener('click', () => {
        const resetPace = {
            globalAverage: 1.65,
            sampleCount: 5,
            platforms: {},
            behavior: {
                tolerance: 0.18,
                preferredAcceleration: 0.85,
                preferredMaxSpeed: 2.8,
                manualOverrides: 0
            }
        };

        chrome.storage.local.set({ hse_pace_profile: resetPace }, () => {
            personalPaceDisplay.textContent = '1.65x';
            statusEl.textContent = 'Personal pace profile reset to 1.65x';
            statusEl.className = 'status-message info show';
            setTimeout(() => statusEl.classList.remove('show'), 2500);
        });
    });

    // Handle keydown for recording hotkeys
    inputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === 'Escape') {
                input.value = input.dataset.oldValue || '';
                input.blur();
                checkCollisions();
                return;
            }

            const keyName = formatKey(e);
            input.value = keyName;
            input.blur();
            checkCollisions();
        });

        input.addEventListener('focus', () => {
            input.classList.add('listening');
            input.dataset.oldValue = input.value;
            input.value = 'Press key...';
        });

        input.addEventListener('blur', () => {
            input.classList.remove('listening');
            if (input.value === 'Press key...') {
                input.value = input.dataset.oldValue || '';
            }
            checkCollisions();
        });
    });

    // Save Preferences
    saveBtn.addEventListener('click', () => {
        const customSettings = {};
        const allowedHotkeys = new Set(['keySpeedUp', 'keySpeedDown', 'keyReset', 'keySkipForward', 'keySkipBack', 'keySmartSpeed']);
        inputs.forEach(input => {
            if (allowedHotkeys.has(input.id)) {
                customSettings[input.id] = String(input.value || '').slice(0, 32);
            }
        });
        const smartVal = parseFloat(selectSmartSpeed.value);
        customSettings.smartSpeedValue = (Number.isFinite(smartVal) && smartVal >= 0.1 && smartVal <= 16) ? Math.round(smartVal * 100) / 100 : 2.0;

        const rawPresets = inputPresets.value.split(',').map(s => parseFloat(s.trim())).filter(n => Number.isFinite(n) && n > 0 && n <= 16);
        const validatedPresets = rawPresets.length ? rawPresets.map(n => Math.round(n * 100) / 100) : [1, 1.25, 1.5, 1.75, 2, 2.5];

        chrome.storage.local.get(['hse_settings'], (result) => {
            const hse_settings = result.hse_settings || {};
            hse_settings.speedStep = parseFloat(selectSpeedStep.value) || 0.1;
            hse_settings.presets = validatedPresets;
            hse_settings.defaultFinishTarget = parseInt(selectFinishTarget.value, 10) || 30;
            hse_settings.adaptiveEnabled = checkAdaptive.checked;
            hse_settings.learnOverrides = checkLearn.checked;

            chrome.storage.local.set({
                hse_custom_settings: customSettings,
                hse_settings: hse_settings
            }, () => {
                statusEl.textContent = 'Preferences saved successfully!';
                statusEl.className = 'status-message success show';
                setTimeout(() => {
                    statusEl.classList.remove('show');
                }, 2500);
            });
        });
    });

    // Reset Defaults
    resetBtn.addEventListener('click', () => {
        inputs.forEach(input => {
            input.value = DEFAULT_SETTINGS[input.id];
            input.classList.remove('collision');
        });
        selectSmartSpeed.value = DEFAULT_SETTINGS.smartSpeedValue;
        selectSpeedStep.value = DEFAULT_SETTINGS.speedStep;
        inputPresets.value = DEFAULT_SETTINGS.speedPresets;
        selectFinishTarget.value = DEFAULT_SETTINGS.defaultFinishTarget;
        checkAdaptive.checked = DEFAULT_SETTINGS.adaptiveEnabled;
        checkLearn.checked = DEFAULT_SETTINGS.learnOverrides;
        checkCollisions();

        chrome.storage.local.get(['hse_settings'], (result) => {
            const hse_settings = result.hse_settings || {};
            hse_settings.speedStep = 0.1;
            hse_settings.presets = [1, 1.25, 1.5, 1.75, 2, 2.5];
            hse_settings.defaultFinishTarget = 30;
            hse_settings.adaptiveEnabled = true;
            hse_settings.learnOverrides = true;

            chrome.storage.local.set({
                hse_custom_settings: {
                    keySpeedUp: DEFAULT_SETTINGS.keySpeedUp,
                    keySpeedDown: DEFAULT_SETTINGS.keySpeedDown,
                    keyReset: DEFAULT_SETTINGS.keyReset,
                    keySkipForward: DEFAULT_SETTINGS.keySkipForward,
                    keySkipBack: DEFAULT_SETTINGS.keySkipBack,
                    keySmartSpeed: DEFAULT_SETTINGS.keySmartSpeed,
                    smartSpeedValue: 2.0
                },
                hse_settings: hse_settings
            }, () => {
                statusEl.textContent = 'Preferences restored to defaults!';
                statusEl.className = 'status-message info show';
                setTimeout(() => {
                    statusEl.classList.remove('show');
                }, 2500);
            });
        });
    });
});
