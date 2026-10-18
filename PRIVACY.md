# Privacy Policy for OTT SPEED PLAYBACK

Last updated: September 2026 (Version 4.1.0)

**OTT SPEED PLAYBACK** ("the Extension") is committed to protecting your privacy under a strict Zero-Trust model. This Privacy Policy explains our local-only data handling and disclosure practices.

## 1. Local Autopilot & Zero Remote Services
The Extension **does not collect, transmit, distribute, log, or sell any personal data**.
All Smart Pace Autopilot features, subtitle frequency heuristics, and speech density calculations operate **strictly locally on your device** inside the browser.
The Extension:
- Does NOT use any remote AI services, cloud speech APIs, or external servers.
- Does NOT record, log, or transmit audio streams or video data.
- Does NOT persist raw subtitle text. Captions are converted in-memory to anonymous numeric signals (words per minute) and immediately discarded.
- Does NOT include any analytics, trackers, telemetry, or remote tracking scripts.

## 2. Local Storage
The Extension uses your browser's local storage (`chrome.storage.local`) exclusively to persist your preferences locally on your machine:
- Preferred video playback speeds associated with platform content identifiers.
- Learned personal pace profiles and behavior tolerances.
- Customized keyboard shortcut bindings and speed step increments.
- Configured finish targets and speed preset buttons.

This data never leaves your device and is not synchronized to external servers or cloud accounts.

## 3. Permissions
The Extension requests only the minimal permissions required to provide video speed control:
- **`activeTab` & `scripting`**: To control playback rates and display overlay controls on active streaming tabs.
- **`storage`**: To persist your playback preferences and personal pace locally on your machine.
- **Host Permissions**: Limited strictly to the supported streaming service domains (Hotstar, Netflix, Prime Video, ZEE5, JioCinema, SonyLIV, Airtel Xstream, Aha, Hoichoi, Sun NXT, and MX Player) to detect video player elements and neutralize ABR quality downgrades.

## 4. Third-Party Services
The Extension does not use any third-party APIs, remote fonts, external CDN scripts, or tracking cookies.

## 5. Changes to this Policy
We may update this Privacy Policy from time to time. Any changes will be reflected in the Extension's repository.

## 6. Contact
If you have any questions or suggestions regarding this Privacy Policy, please open an issue on the Extension's project repository.
