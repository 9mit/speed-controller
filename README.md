# OTT SPEED PLAYBACK (v2.4.0)
### High-performance playback speed controller with Smart Pace finish-time targeting for popular streaming services.

<img src="icon128.png" width="128" height="128" alt="OTT SPEED PLAYBACK Logo">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.4.0-green.svg)](manifest.json)
[![Platform](https://img.shields.io/badge/Platform-Chrome%20|%20Edge%20|%20Firefox-lightgrey.svg)](manifest.json)

---

## Overview

**OTT SPEED PLAYBACK** gives you complete, robust control over your video playback speed across major streaming and OTT platforms. Built upon the battle-tested, lightweight v2.3 architecture, version 2.4.0 adds **Smart Pace Finish-Time Mode**—allowing you to choose how much time you have, and automatically calculating the optimal playback rate to finish right on schedule.

### What Makes v2.4.0 Special:
- **Zero Quality Drops (`main_world.js`)**: Neutralizes aggressive Adaptive Bitrate (ABR) downshifting in Shaka Player and Hls.js during high-speed playback, keeping video crystal clear in 1080p/4K.
- **Smart Pace Finish-Time Mode**: Select quick target finish times (`20m`, `30m`, `45m`, `60m`) or enter a custom duration in minutes. The controller calculates exact playback speed based on remaining video duration versus remaining wall time.
- **Pause-Aware & Seek-Aware**: Wall time automatically freezes while video is paused, and required speed instantly recalculates if you seek forward or backward.
- **Smooth Speed Adjustments**: Uses hysteresis thresholding (`0.05x`) and adjustment cooldowns to eliminate jitter and distracting micro-changes.
- **Persistent Speed Memory**: Remembers your preferred playback speed per show / title across page reloads.
- **One-Click Action Toggle**: Clicking the extension icon in your browser toolbar instantly toggles the in-page speed overlay.
- **100% Private & Local**: Zero remote AI, no analytics, no external tracking, no telemetry, and local-only storage.

---

## Supported Streaming Services

1. **Disney+ Hotstar / JioHotstar** (`hotstar.com`, `jiohotstar.com`)
2. **Netflix** (`netflix.com`)
3. **Amazon Prime Video** (`primevideo.com`, regional `amazon.*/gp/video/*`)
4. **ZEE5** (`zee5.com`)
5. **JioCinema** (`jiocinema.com`)
6. **SonyLIV** (`sonyliv.com`)
7. **Airtel Xstream / Xstream Play** (`airtelxstream.in`, `xstreamplay.in`)
8. **Aha** (`aha.video`)
9. **Hoichoi** (`hoichoi.tv`)
10. **Sun NXT** (`sunnxt.com`)
11. **MX Player** (`mxplayer.in`)

---

## Default Keyboard Shortcuts

| Action | Shortcut | Description |
| :--- | :--- | :--- |
| **Speed Down** | `[` | Decrease speed by 0.1x |
| **Speed Up** | `]` | Increase speed by 0.1x |
| **Reset Normal** | `r` | Return immediately to 1.0x normal speed |
| **Smart Speed** | `Shift` *(Hold)* | Temporary fast-forward boost (default: 2.0x) |
| **Rewind** | `ArrowLeft` | Jump back 10 seconds |
| **Skip Forward** | `ArrowRight` | Jump forward 10 seconds |

*All keyboard shortcuts and step sizes can be customized in the Extension Options page.*

---

## Privacy & Security Guarantees

- **Zero External APIs or Analytics**: Operates 100% locally in your browser.
- **Zero Network Telemetry**: Never makes outbound network requests.
- **Local Storage Only**: All speed preferences reside solely in your browser's `chrome.storage.local`.
- **Strict Least Privilege**: Manifest permissions are strictly limited to `activeTab`, `scripting`, `storage`, and designated streaming host patterns.

---

## Technical Architecture

```text
OTT SPEED PLAYBACK v2.4.0
 ├── main_world.js             (ABR bitrate neutralizer, Shaka/Hls protection)
 ├── background.js             (Service worker, toolbar action click toggle, options router)
 ├── content.js
 │    ├── 11 Platform Adapters (Hotstar, Netflix, Prime, Zee5, JioCinema, SonyLIV, etc.)
 │    ├── HSE_Intel            (Deep DOM & Shadow-DOM video element discovery)
 │    ├── HSE_Engine           (Playback speed enforcement & synchronization)
 │    ├── HSE_SmartPace        (Finish-time calculation, pause compensation & hysteresis)
 │    ├── HSE_Store            (Local storage hydration, per-show memory & pace profile)
 │    ├── HSE_UI               (Floating glassmorphism speed panel & video badge)
 │    └── HSE_Input            (Keyboard shortcut listener & typing guard)
 └── styles.css                (Lightweight glassmorphic UI stylesheet)
```

---

## Installation & Development

### Chrome & Edge (Load Unpacked)
1. Open `chrome://extensions/` or `edge://extensions/`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the root directory of this extension.

### Run Static & Syntax Verification
```bash
node --check content.js background.js options.js main_world.js
```

---

*Disclaimer: This project is an independent open-source tool and is not affiliated with, endorsed by, or associated with Disney, Hotstar, Jio, Netflix, Amazon, or any streaming provider.*
