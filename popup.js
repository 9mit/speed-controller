/**
 * OTT SPEED PLAYBACK - Action Popup Controller (v4.0.0)
 */

document.addEventListener('DOMContentLoaded', async () => {
    const activeView = document.getElementById('activeView');
    const inactiveView = document.getElementById('inactiveView');
    const openOptionsBtn = document.getElementById('openOptionsBtn');

    // Active View Elements
    const platformBadge = document.getElementById('platformBadge');
    const streamTitle = document.getElementById('streamTitle');
    const popupTargetInput = document.getElementById('popupTargetInput');
    const popupToggleAutopilotBtn = document.getElementById('popupToggleAutopilotBtn');
    const popupUseMyPaceBtn = document.getElementById('popupUseMyPaceBtn');
    const popupTelemetryHUD = document.getElementById('popupTelemetryHUD');
    const popupHudSpeed = document.getElementById('popupHudSpeed');
    const popupHudReason = document.getElementById('popupHudReason');
    const popupHudRemaining = document.getElementById('popupHudRemaining');
    const popupHudStatus = document.getElementById('popupHudStatus');

    // Manual speed controls
    const stepDownBtn = document.getElementById('stepDownBtn');
    const resetSpeedBtn = document.getElementById('resetSpeedBtn');
    const stepUpBtn = document.getElementById('stepUpBtn');
    const presetsGrid = document.getElementById('presetsGrid');
    const skipBackBtn = document.getElementById('skipBackBtn');
    const skipForwardBtn = document.getElementById('skipForwardBtn');
    const toggleOverlayBtn = document.getElementById('toggleOverlayBtn');

    let currentSpeed = 1.0;
    let speedStep = 0.1;
    let currentTabId = null;
    let isAutopilotActive = false;

    // Open options page
    openOptionsBtn.addEventListener('click', () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            chrome.runtime.sendMessage({ action: 'openOptionsPage' });
        }
    });

    function updateAutopilotUI(smartPace) {
        if (!smartPace) return;
        isAutopilotActive = smartPace.isActive;

        if (isAutopilotActive) {
            popupToggleAutopilotBtn.textContent = 'STOP AUTOPILOT';
            popupToggleAutopilotBtn.classList.add('is-stopping');
            popupTelemetryHUD.style.display = 'block';

            popupHudSpeed.textContent = smartPace.currentSpeed;
            popupHudReason.textContent = smartPace.reason || 'Adapting';
            popupHudRemaining.textContent = `${smartPace.remainingWall} left (Req: ${smartPace.requiredSpeed})`;
            popupHudStatus.textContent = smartPace.status.replace('_', ' ').toUpperCase();
            popupHudStatus.className = `hud-status ${smartPace.status}`;
        } else {
            popupToggleAutopilotBtn.textContent = 'START AUTOPILOT';
            popupToggleAutopilotBtn.classList.remove('is-stopping');
            popupTelemetryHUD.style.display = 'none';
        }
    }

    function renderPresets(presets) {
        presetsGrid.replaceChildren();
        presets.forEach((preset) => {
            const chip = document.createElement('button');
            chip.className = 'preset-chip';
            chip.dataset.speed = String(preset);
            chip.textContent = `${preset}x`;
            if (Math.abs(preset - currentSpeed) < 0.01) {
                chip.classList.add('is-active');
            }
            chip.addEventListener('click', () => {
                sendSpeed(preset);
            });
            presetsGrid.appendChild(chip);
        });
    }

    async function sendSpeed(newSpeed) {
        if (!currentTabId) return;
        try {
            const resp = await chrome.tabs.sendMessage(currentTabId, {
                action: 'setSpeed',
                speed: newSpeed
            });
            if (resp && resp.success) {
                currentSpeed = resp.newSpeed;
                renderPresetsActive();
            }
        } catch (_) {}
    }

    function renderPresetsActive() {
        document.querySelectorAll('.preset-chip').forEach((chip) => {
            const chipSpeed = parseFloat(chip.dataset.speed);
            chip.classList.toggle('is-active', Math.abs(chipSpeed - currentSpeed) < 0.01);
        });
    }

    async function toggleAutopilot(targetMin, usePersonal = false) {
        if (!currentTabId) return;
        if (isAutopilotActive && !usePersonal && !targetMin) {
            // Stop
            try {
                await chrome.tabs.sendMessage(currentTabId, { action: 'stopSmartPace' });
                isAutopilotActive = false;
                updateAutopilotUI({ isActive: false });
            } catch (_) {}
        } else {
            // Start
            try {
                const resp = await chrome.tabs.sendMessage(currentTabId, {
                    action: 'startSmartPace',
                    minutes: targetMin || parseInt(popupTargetInput.value, 10) || 30,
                    usePersonalPace: usePersonal
                });
                if (resp && resp.success) {
                    updateAutopilotUI(resp.progress);
                }
            } catch (_) {}
        }
    }

    // Connect to active tab
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
            showInactive();
            return;
        }
        currentTabId = tab.id;

        chrome.tabs.sendMessage(tab.id, { action: 'getPlaybackState' }, (response) => {
            if (chrome.runtime.lastError || !response || !response.supported) {
                showInactive();
                return;
            }

            // Populate Active View
            showActive();
            platformBadge.textContent = response.platformLabel || 'Streaming';
            streamTitle.textContent = response.title || 'Current Video';
            speedStep = response.speedStep || 0.1;
            currentSpeed = response.currentSpeed || 1.0;

            if (response.personalPace) {
                popupUseMyPaceBtn.textContent = `Use my pace (${response.personalPace.toFixed(2)}x)`;
            }

            stepDownBtn.textContent = `-${speedStep}x`;
            stepUpBtn.textContent = `+${speedStep}x`;

            const presets = response.presets || [1, 1.25, 1.5, 1.75, 2, 2.5];
            renderPresets(presets);

            if (response.smartPace) {
                updateAutopilotUI(response.smartPace);
                if (response.smartPace.targetMinutes) {
                    popupTargetInput.value = response.smartPace.targetMinutes;
                }
            }
        });
    } catch (_) {
        showInactive();
    }

    function showActive() {
        activeView.style.display = 'flex';
        activeView.style.flexDirection = 'column';
        activeView.style.gap = '10px';
        inactiveView.style.display = 'none';
    }

    function showInactive() {
        activeView.style.display = 'none';
        inactiveView.style.display = 'flex';
        inactiveView.style.flexDirection = 'column';
        inactiveView.style.gap = '10px';
    }

    // Smart Pace Target Chips
    document.querySelectorAll('.target-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const min = parseInt(chip.dataset.min, 10);
            popupTargetInput.value = min;
            toggleAutopilot(min);
        });
    });

    popupToggleAutopilotBtn.addEventListener('click', () => {
        toggleAutopilot();
    });

    popupUseMyPaceBtn.addEventListener('click', () => {
        toggleAutopilot(null, true);
    });

    // Manual Stepper buttons
    stepDownBtn.addEventListener('click', () => {
        const next = Math.max(0.1, +(currentSpeed - speedStep).toFixed(2));
        sendSpeed(next);
    });

    stepUpBtn.addEventListener('click', () => {
        const next = Math.min(16, +(currentSpeed + speedStep).toFixed(2));
        sendSpeed(next);
    });

    resetSpeedBtn.addEventListener('click', () => {
        sendSpeed(1.0);
    });

    skipBackBtn.addEventListener('click', () => {
        if (!currentTabId) return;
        chrome.tabs.sendMessage(currentTabId, { action: 'skip', seconds: -10 });
    });

    skipForwardBtn.addEventListener('click', () => {
        if (!currentTabId) return;
        chrome.tabs.sendMessage(currentTabId, { action: 'skip', seconds: 10 });
    });

    toggleOverlayBtn.addEventListener('click', () => {
        if (!currentTabId) return;
        chrome.tabs.sendMessage(currentTabId, { action: 'toggleOverlay' });
        window.close();
    });
});
