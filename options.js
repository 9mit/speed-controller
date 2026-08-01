const DEFAULT_SETTINGS = {
    keySpeedUp: ']',
    keySpeedDown: '[',
    keyReset: 'r',
    keySkipForward: 'ArrowRight',
    keySkipBack: 'ArrowLeft',
    keySmartSpeed: 'Shift',
    smartSpeedValue: '2.0'
};

function formatKey(e) {
    if (e.key === ' ') return 'Space';
    if (e.key.length === 1) return e.key; // retain case for letters/symbols
    return e.key; // e.g. ArrowRight, Shift, Control
}

document.addEventListener('DOMContentLoaded', () => {
    const inputs = document.querySelectorAll('.hotkey-input');
    const select = document.getElementById('smartSpeedValue');
    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');
    const statusEl = document.getElementById('statusMessage');

    // Load existing settings
    chrome.storage.local.get(['hse_custom_settings'], (result) => {
        const settings = result.hse_custom_settings || DEFAULT_SETTINGS;
        
        inputs.forEach(input => {
            const key = input.id;
            input.value = settings[key] || DEFAULT_SETTINGS[key];
        });
        select.value = settings.smartSpeedValue || DEFAULT_SETTINGS.smartSpeedValue;
    });

    // Handle keydown for recording hotkeys
    inputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            e.preventDefault(); // prevent scrolling or default actions
            e.stopPropagation();

            // ignore naked meta keys if we want to allow combinations later, 
            // but for now we just take the single key pressed.
            const keyName = formatKey(e);
            
            // Allow escape to cancel listening
            if (e.key === 'Escape') {
                input.blur();
                return;
            }

            input.value = keyName;
            input.blur(); // auto blur after selection
        });

        input.addEventListener('focus', () => {
            input.classList.add('listening');
            input.dataset.oldValue = input.value;
            input.value = 'Press key...';
        });

        input.addEventListener('blur', () => {
            input.classList.remove('listening');
            if (input.value === 'Press key...') {
                input.value = input.dataset.oldValue;
            }
        });
    });

    // Save
    saveBtn.addEventListener('click', () => {
        const newSettings = {};
        inputs.forEach(input => {
            newSettings[input.id] = input.value;
        });
        newSettings.smartSpeedValue = select.value;

        chrome.storage.local.set({ hse_custom_settings: newSettings }, () => {
            statusEl.textContent = 'Settings saved successfully!';
            statusEl.classList.add('show');
            setTimeout(() => {
                statusEl.classList.remove('show');
            }, 2000);
        });
    });

    // Reset
    resetBtn.addEventListener('click', () => {
        inputs.forEach(input => {
            input.value = DEFAULT_SETTINGS[input.id];
        });
        select.value = DEFAULT_SETTINGS.smartSpeedValue;
        
        chrome.storage.local.set({ hse_custom_settings: DEFAULT_SETTINGS }, () => {
            statusEl.textContent = 'Reset to defaults!';
            statusEl.classList.add('show');
            setTimeout(() => {
                statusEl.classList.remove('show');
            }, 2000);
        });
    });
});
