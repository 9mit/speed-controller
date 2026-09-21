# OTT SPEED PLAYBACK (v4.0.0)
### The playback autopilot that automatically decides how fast each part of a video should play.

<img src="icon128.png" width="128" height="128" alt="OTT SPEED PLAYBACK Logo">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-4.0.0-green.svg)](manifest.json)
[![Platform](https://img.shields.io/badge/Platform-Chrome%20|%20Edge%20|%20Firefox-lightgrey.svg)](manifest.json)

---

## The Paradigm Shift

> **Traditional speed controller:** You choose the speed.  
> **OTT SPEED PLAYBACK v4:** You choose how much time you have. The extension chooses the speed.

Instead of keeping playback pinned to a single speed throughout an entire video, OTT SPEED PLAYBACK acts as an intelligent **playback autopilot**. Choose your target finish time (e.g. *"Finish this video in 30 minutes"*), and the content-aware adaptive engine dynamically and smoothly adjusts speed based on real-time content complexity:

- **Dense, rapid dialogue** → Gently slows down (e.g. `1.35x` – `1.50x`) so you never miss key plot points.
- **Normal conversation** → Plays at comfortable brisk pace (e.g. `1.55x` – `1.75x`).
- **Simple dialogue & pauses** → Accelerates smoothly (e.g. `1.85x` – `2.20x`).
- **Long silences & landscape pans** → Powers through (e.g. `2.50x` – `4.00x`).
- **Intros & Theme sequences** → Safely skips through (e.g. `2.50x` – `3.00x`).
- **Ending credits** → Fast-tracks to completion (up to `6.00x`).

All adjustments are calculated **100% locally in your browser** using lightweight heuristic signals—**no remote AI, no external APIs, and zero privacy compromise**.

---

## Key Features

### ⚡ Smart Pace Autopilot
- **Finish-Time Targeting**: Choose quick targets (`20m`, `30m`, `45m`, `60m`) or enter custom minutes.
- **Content-Aware Adaptive Variations**: Dynamically balances dialogue density, pause durations, and remaining wall time to guarantee you finish on schedule.
- **Live Telemetry HUD**: Displays real-time adaptive speed, active content classification (e.g. *Dense dialogue*, *Long pause*, *Catching up*), remaining wall time, and status (*ON TRACK*, *AHEAD*, *CATCHING UP*, *IMPOSSIBLE*).
- **Human-Friendly Transitions**: Employs hysteresis and transition smoothing (`MIN_SPEED_CHANGE = 0.05`, 2s cooldown) to eliminate jarring speed oscillations.

### 🧠 Personal Pace Learning 2.0
- **Learns How You Watch**: Remembers your manual speed choices and overrides per platform.
- **"Use My Normal Pace"**: One-click action calculates your personalized target finish time automatically.

### ⏱️ Time Saved Moment & Local Sharing
- **Viewing Completion Summary**: Celebrates completed videos showing original duration, actual viewing time, total time saved, and average pace.
- **One-Click Local Copy**: Copies a friendly summary to your clipboard (*e.g., "I watched a 52-minute video in 31 minutes using OTT SPEED PLAYBACK. Saved 21 minutes."*).

### 🛡️ Quality & Resolution Preservation (`main_world.js`)
- Neutralizes Adaptive Bitrate (ABR) resolution downgrades and dropped-frame penalties in Hls.js, Shaka Player, and Dash.js engines during accelerated playback.

### 🎮 Complete Manual & Overlay Controls
- Draggable on-screen HUD with quick presets (`1x`, `1.25x`, `1.5x`, `1.75x`, `2x`, `2.5x`), fine steppers (`-0.1x`, `+0.1x`, `1.0x Reset`), and fullscreen container reparenting.
- Browser action popup with matching autopilot controls and shortcuts cheatsheet.
- Global keyboard command: `Alt+Shift+S` to toggle on-screen HUD at any moment.

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
| **Speed Down** | `[` | Decrease speed by step increment |
| **Speed Up** | `]` | Increase speed by step increment |
| **Reset Normal** | `r` | Return immediately to 1.0x normal speed |
| **Smart Speed** | `Shift` *(Hold)* | Momentary fast-forward (default: 2.0x) |
| **Rewind** | `ArrowLeft` | Jump back 10 seconds |
| **Skip Forward** | `ArrowRight` | Jump forward 10 seconds |
| **Toggle HUD** | `Alt+Shift+S` | Toggle in-player Smart Pace HUD |

*Shortcuts can be customized in the extension Preferences page.*

---

## Privacy & Security Guarantees

- **Zero Remote AI or Speech APIs**: Content analysis runs exclusively in-browser via DOM heuristics and media timing.
- **Zero Network Egress**: The extension never transmits data, analytics, or telemetry to external servers.
- **Local Storage Only**: Preferences and pace profiles reside strictly in `chrome.storage.local`.
- **Least Privilege**: Manifest permissions are limited to `activeTab`, `scripting`, `storage`, and specific video origins.

---

## Technical Architecture

```text
content.js
 ├── Platform detection        (13 streaming platforms + regional Prime domains)
 ├── HSE_Intel                 (Shadow-DOM video discovery & player reconnection)
 ├── HSE_Analyzer              (Content difficulty, speech density & silence detection)
 ├── HSE_AdaptiveEngine        (Finish-time budget calculator & pacing state machine)
 ├── HSE_Store                 (Local storage hydration & Personal Pace Learning 2.0)
 ├── HSE_UI                    (Hero Smart Pace HUD, completion modal & indicators)
 └── HSE_Input                 (Keyboard isolation & modifier collision prevention)
```

---

## Installation

### Chrome & Edge
1. Clone or download this repository.
2. Open `chrome://extensions/` (or `edge://extensions/`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this directory.

### Firefox
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `manifest.json`.

---

## Running Automated Tests

```bash
npm test
```

---

*Disclaimer: This project is an independent open-source tool and is not affiliated with, endorsed by, or associated with Disney, Hotstar, Jio, Netflix, Amazon, or any streaming provider.*
