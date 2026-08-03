# OTT SPEED PLAYBACK
### Adjust playback speed with custom rate controls, keyboard shortcuts, and saved speed preferences on popular streaming services.

<img src="icon128.png" width="128" height="128" alt="OTT SPEED PLAYBACK Logo">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.1-green.svg)](manifest.json)
[![Platform](https://img.shields.io/badge/Platform-Chrome%20|%20Edge-lightgrey.svg)](https://developer.chrome.com/docs/extensions/)

OTT SPEED PLAYBACK is a browser extension for playback rate control on **Disney+ Hotstar / JioHotstar**, **Netflix**, **Amazon Prime Video**, **ZEE5**, **Airtel Xstream**, **JioCinema**, **SonyLIV**, **Aha**, **Hoichoi**, **Sun NXT**, and **MX Player**.

---

## Features

- **Multi-platform**: Works on Hotstar, JioHotstar, Netflix, Prime Video (including regional Amazon video pages), ZEE5, Airtel Xstream, JioCinema, SonyLIV, Aha, Hoichoi, Sun NXT, and MX Player.
- **Speed presets**: Overlay controls for 1x, 1.5x, 2x, and 2.5x.
- **Keyboard**: `[` / `]` adjust speed by 0.1 (up to 16x).
- **Per-title memory**: Remembers your preferred speed per show/movie (namespaced per platform).
- **SPA-aware**: Reloads settings on client-side navigation (`pushState` / `replaceState` / `popstate`).
- **Shadow DOM video discovery**: Finds player `<video>` elements inside open shadow roots (needed on Netflix).

---

## Privacy & security

- **No network egress**: The extension does not call remote APIs, analytics, or beacons. Nothing is uploaded.
- **Local storage only**: Speeds are saved in `chrome.storage.local` (not sync). Payload is allowlisted to `globalSpeed` and numeric `showSpeeds` keys.
- **No titles or URLs persisted**: Page titles are display-only in the overlay UI; cookies, tokens, and account data are never read or stored.
- **Safe UI rendering**: Overlay text uses DOM/`textContent` (no title interpolation into HTML).
- **Minimal permissions**: `activeTab`, `scripting`, `storage`, plus host access limited to the supported OTT origins.

---

## Usage

1. Open a supported streaming site and start a video.
2. Click the extension icon to toggle the speed panel.
3. Use presets or `[` / `]` to change speed.

Supported hosts:
- `*.hotstar.com`, `*.jiohotstar.com`
- `*.netflix.com`
- `*.primevideo.com`
- Amazon video paths: `*/gp/video/*` on major regional Amazon domains
- `*.zee5.com`
- `*.airtelxstream.in`
- `*.xstreamplay.in`
- `*.jiocinema.com`
- `*.sonyliv.com`
- `*.aha.video`
- `*.hoichoi.tv`
- `*.sunnxt.com`
- `*.mxplayer.in`

---

## Technical notes

- **Platform adapters** detect the host and extract content IDs from URL patterns (Hotstar watch IDs, Netflix title/watch IDs, Prime ASINs).
- **Enforcement loop** re-applies `playbackRate` every second if the site player resets it.
- **Storage keys** look like `netflix:80057281` so platforms never collide; IDs and speeds are sanitized before write.
- **Files**: `content.js` (player UI + persistence), `background.js` (toolbar activation), `manifest.json` (MV3).

---

## Installation

1. Clone or download this repository.
2. Open Chrome → `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this project folder.
5. Open Hotstar, Netflix, or Prime Video and click the toolbar icon.

---

## Contributing

Contributions are welcome. Keep platform-specific URL/title/video logic inside the adapters in `content.js`. Do not add network calls, telemetry, or broader host permissions without a clear need.

---
*Disclaimer: This project is an independent tool and is not affiliated with Disney, Hotstar, Jio, Netflix, Amazon, or Prime Video.*
